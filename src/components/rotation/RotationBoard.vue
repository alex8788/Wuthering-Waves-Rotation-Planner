<script setup lang="ts">
// ============================================================
// RotationBoard.vue — 主時間軸面板：三條 Swimlane 的總容器。
//
// 職責（R5 拆分後）：本檔只保留「組裝與落點預覽/FLIP」；
//   - 欄寬量測      → useColumnMeasure
//   - 邊緣自動捲動  → useEdgeAutoScroll
//   - 矩形框選      → useMarquee
//   - 泳道垂直拖曳  → useLaneReorder
//   - 泳道分流/欄序 → useLaneLayout
//
// 設計原則：區塊拖曳由 Swimlane 內 SortableJS 處理；框選刻意與其完全隔離
//           （掛 window bubble、按在區塊上讓位），避免互搶事件。
// ============================================================

import { computed, onMounted, nextTick, ref, watch } from 'vue'
import Swimlane from '@/components/rotation/Swimlane.vue'
import BlockChip from '@/components/ui/BlockChip.vue'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useRotationStore } from '@/stores/useRotationStore'
import { useLaneOrder } from '@/composables/state/useLaneOrder'
import { useLaneLayout } from '@/composables/board/useLaneLayout'
import { useColumnMeasure } from '@/composables/board/useColumnMeasure'
import { useHeaderWidth } from '@/composables/board/useHeaderWidth'
import { useEdgeAutoScroll } from '@/composables/board/useEdgeAutoScroll'
import { useMarquee } from '@/composables/board/useMarquee'
import { useLaneReorder } from '@/composables/board/useLaneReorder'
import { useHistory } from '@/composables/state/useHistory'
import { DELETE_ZONE_ATTRIBUTE, useBlockDrag } from '@/composables/useBlockDrag'
import { getElementColor } from '@/constants/elements'
import { TRACK_GAP_PX } from '@/constants/layout'
import { prefersReducedMotion } from '@/utils/reducedMotion'
import type { SlotIndex } from '@/types/character'
import type { RotationEntry } from '@/types/rotation'

// ── Stores ───────────────────────────────────────────────────

const characterStore = useCharacterStore()
const rotationStore = useRotationStore()
const { laneOrder } = useLaneOrder()
const { dragState, notifyAutoScroll } = useBlockDrag()
const history = useHistory()

// ── 泳道顯示順序 ─────────────────────────────────────────────
// 依 laneOrder 把 slots 重新排成「上下顯示順序」。slots 以 slotIndex 為索引，
// slots[si].slotIndex === si，故直接映射即可。entries / 欄位對齊全不受影響。
const orderedSlots = computed(() => laneOrder.value.map((si) => characterStore.slots[si]))

// ── 動態 header 寬度：依三泳道「最長角色名」量出共用寬度 ─────────
// 三泳道 header 必須等寬才能與時間欄對齊，故算一次、以 CSS 變數下傳。
// 算法抽到 useHeaderWidth，與匯出視圖（RotationExportView）共用，確保一致。
const { headerWidthPx } = useHeaderWidth()

// ── 依 slotIndex 分流 + 單線程欄位對齊（共用 useLaneLayout，R2）──

const { entriesBySlot, idToColumn: idToColumnIndex } = useLaneLayout(
  () => rotationStore.entries,
)

function measurerColor(entry: RotationEntry): string {
  // 量測列為隱藏列，僅用於量欄寬，顏色不影響結果；沿用屬性色保持一致。
  return getElementColor(characterStore.slotCharacters[entry.slotIndex]?.element ?? null)
}

// 量測列用的 label：編輯中的區塊改用「即時草稿」而非已提交 label，
// 使欄寬隨輸入即時重算（編輯時區塊即時變寬、鄰塊即時順延）。
function measurerLabel(entry: RotationEntry): string {
  return entry.id === rotationStore.editingId ? rotationStore.editingDraft : entry.block.label
}

// 欄寬量測（隱藏量測列 → grid-template-columns；含 entries/草稿/resize/字型重量）
const measurerRef = ref<HTMLElement | null>(null)
const { columnWidths, gridTemplate } = useColumnMeasure(measurerRef)

// ── 側邊欄多選拖曳：量測整組來源模板的合計寬度（供落點預覽顯示對齊主軸的
//    「自動調整寬度」空欄）。隱藏量測列只渲染 chip，量完加上塊間距加總。──
const draggingGroupMeasurerRef = ref<HTMLElement | null>(null)
const draggingGroupWidth = ref<number>(0)

function measureDraggingGroup(): void {
  const el = draggingGroupMeasurerRef.value
  if (!el || el.children.length === 0) {
    draggingGroupWidth.value = 0
    return
  }
  const ws = Array.from(el.children).map((c) => (c as HTMLElement).getBoundingClientRect().width)
  draggingGroupWidth.value = ws.reduce((a, b) => a + b, 0) + TRACK_GAP * (ws.length - 1)
}

watch(
  () => dragState.draggingSourceBlocks,
  async () => {
    await nextTick()
    measureDraggingGroup()
  },
  { deep: false },
)

// ── 拖曳落點預覽（single thread 跨泳道同步擠出，含多選）─────────

const PREVIEW_PLACEHOLDER = '__preview_placeholder__'

// 區塊間距：與 Swimlane 的 --track-gap / 匯出視圖共用單一常數（constants/layout.ts），
// 把「欄序」換算成像素 x 位移（FLIP 平滑順延、落點寬度加總）時幾何模型與渲染一致。
const TRACK_GAP = TRACK_GAP_PX

const isPreviewing = computed<boolean>(
  () => dragState.isDragging && dragState.previewInsertAfterIndex !== null,
)

const previewLayout = computed<{
  template: string
  idToColumn: Map<string, number>
  // id → 該欄左緣在共用 grid 內的 px 座標（三泳道共用 template，故全域一致）。
  // 僅預覽時計算，供 FLIP 解析式位移用；非預覽時為 null（不做動畫）。
  idToX: Map<string, number> | null
  placeholderColumn: number | null
  slotIndex: SlotIndex | null
}>(() => {
  if (!isPreviewing.value) {
    return {
      template: gridTemplate.value,
      idToColumn: idToColumnIndex.value,
      idToX: null,
      placeholderColumn: null,
      slotIndex: null,
    }
  }

  const entries = rotationStore.entries
  const widths = columnWidths.value
  const afterIn = dragState.previewInsertAfterIndex as number
  const draggingId = dragState.draggingId
  const isRotationSource = dragState.sourceType === 'rotation-instance'

  const draggingIds = dragState.draggingIds
  const idSet = new Set<string>(draggingIds.length ? draggingIds : draggingId ? [draggingId] : [])

  let placeholderWidth = dragState.draggingWidth
  // 側邊欄多選拖入：空欄寬＝整組來源模板量得的合計寬度（對齊主軸「自動調整寬度」落點）
  if (!isRotationSource && dragState.draggingSourceBlocks.length > 1 && draggingGroupWidth.value > 0) {
    placeholderWidth = draggingGroupWidth.value
  }
  if (isRotationSource && idSet.size > 0) {
    let sum = 0
    let cnt = 0
    entries.forEach((e, i) => {
      if (idSet.has(e.id)) {
        sum += widths[i] ?? 0
        cnt++
      }
    })
    if (cnt > 0) placeholderWidth = sum + TRACK_GAP * (cnt - 1)
  }

  const cols = entries.map((e, i) => ({ id: e.id, width: widths[i] ?? 0 }))
  const insertAt = afterIn < 0 ? 0 : Math.min(afterIn + 1, cols.length)
  cols.splice(insertAt, 0, { id: PREVIEW_PLACEHOLDER, width: placeholderWidth })
  const working = isRotationSource ? cols.filter((c) => !idSet.has(c.id)) : cols

  const idToColumn = new Map<string, number>()
  const idToX = new Map<string, number>()
  let x = 0
  working.forEach((c, i) => {
    idToColumn.set(c.id, i)
    idToX.set(c.id, x)
    x += c.width + TRACK_GAP
  })
  const template = working.map((c) => `${c.width}px`).join(' ')

  return {
    template,
    idToColumn,
    idToX,
    placeholderColumn: idToColumn.get(PREVIEW_PLACEHOLDER) ?? null,
    slotIndex: dragState.previewSlotIndex,
  }
})

const previewGridTemplate = computed<string>(() => previewLayout.value.template)
const previewIdToColumn = computed<Map<string, number>>(() => previewLayout.value.idToColumn)

// ── 拖曳「平滑順延」FLIP ──────────────────────────────────────
// grid-column 離散無法 CSS 補間 → 落點變動時鄰塊會瞬移閃爍。故每次落點變動後對欄序
// 有變的區塊補一段 transform 滑動：位移＝舊欄左緣x−新欄左緣x，純用 idToX（欄寬解析式）
// 算、不量 DOM → 不觸發 reflow。只動「非被拖」區塊，不與 SortableJS 佔用的 transform 衝突。
const FLIP_MS = 140
let _flipPrevX: Map<string, number> | null = null

// 以目前「靜止」佈局（無落點空欄）建立 id→x 基準，供拖曳首幀動畫起點。
function restingIdToX(): Map<string, number> {
  const m = new Map<string, number>()
  let x = 0
  rotationStore.entries.forEach((e, i) => {
    m.set(e.id, x)
    x += (columnWidths.value[i] ?? 0) + TRACK_GAP
  })
  return m
}

function runFlip(newX: Map<string, number> | null): void {
  if (prefersReducedMotion()) return
  if (!dragState.isDragging || !newX) {
    _flipPrevX = null
    return
  }
  const prev = _flipPrevX
  _flipPrevX = newX
  if (!prev) return // 拖曳首幀：只記基準，不動畫
  const root = boardScrollRef.value
  if (!root) return
  for (const [id, nx] of newX) {
    const ox = prev.get(id)
    if (ox === undefined) continue // 新出現（落點/剛入軸）→ 無起點，不滑
    const delta = ox - nx
    if (Math.abs(delta) < 0.5) continue
    // 限定 board 內查詢 → 自動排除 <body> 上的 SortableJS 浮動分身
    const el = root.querySelector<HTMLElement>(`.rotation-block[data-entry-id="${id}"]`)
    if (!el) continue
    // FLIP：先瞬移回舊位（transition none），下一幀放手讓它滑回 0
    el.style.transition = 'none'
    el.style.transform = `translateX(${delta}px)`
    requestAnimationFrame(() => {
      el.style.transition = `transform ${FLIP_MS}ms ease-out`
      el.style.transform = ''
    })
  }
}

// 拖曳結束後清掉殘留的 inline transform/transition，避免污染靜止樣式
function clearFlipStyles(): void {
  boardScrollRef.value
    ?.querySelectorAll<HTMLElement>('.rotation-block')
    .forEach((el) => {
      if (el.style.transform || el.style.transition) {
        el.style.transition = ''
        el.style.transform = ''
      }
    })
}

watch(() => previewLayout.value, (layout) => runFlip(layout.idToX), { flush: 'post' })

// ── 邊緣自動捲動 / 框選（R5 抽離）───────────────────────────

const boardScrollRef = ref<HTMLElement | null>(null)

// 拖曳邊緣自動捲動：每次實際捲動後重算拖曳落點
const autoScroll = useEdgeAutoScroll(boardScrollRef, notifyAutoScroll)

watch(
  () => dragState.isDragging,
  (now) => {
    if (now) {
      autoScroll.start()
      _flipPrevX = restingIdToX() // 種下基準，讓首次落點變動就能從靜止位置滑出
    } else {
      autoScroll.stop()
      _flipPrevX = null
      setTimeout(clearFlipStyles, FLIP_MS + 40) // 等收尾動畫播完再清除殘留 inline 樣式
    }
  },
)

// 跨三泳道矩形框選：與區塊拖曳徹底隔離（拖曳中停用；命中結果寫入選取）
const { marquee } = useMarquee({
  enabled: () => !dragState.isDragging,
  onSelect: (ids, additive) => rotationStore.selectBlocks(ids, additive),
})

// ── 假資料初始化（開發模式驗證用）──────────────────────────

function seedStoreWithStubData(): void {
  if (rotationStore.entries.length > 0) return

  const chars = characterStore.slotCharacters
  const stubLabels = [
    ['A', '3AE', 'E', 'R', 'A'],
    ['E', 'Z', 'A', 'EQ'],
    ['3A', 'R', 'D', 'A', 'E'],
  ] as const

  stubLabels.forEach((labels, idx) => {
    const slotIndex = idx as SlotIndex
    const char = chars[idx]
    if (!char) return
    labels.forEach((label) => {
      rotationStore.addFreeformBlock(label, getElementColor(char.element), slotIndex, char.id)
    })
  })
}

// ── 泳道垂直拖曳（R5 抽離至 useLaneReorder）──────────────────
const rotationBoardRef = ref<HTMLElement | null>(null)
const { laneDrag, onLaneDragStart } = useLaneReorder(rotationBoardRef)

onMounted(() => {
  if (import.meta.env.DEV) {
    const slots = characterStore.slots
    if (!slots[0].character) characterStore.setCharacter(0, 'jiyan')
    if (!slots[1].character) characterStore.setCharacter(1, 'verina')
    if (!slots[2].character) characterStore.setCharacter(2, 'shorekeeper')
    seedStoreWithStubData()
    // 程式化初始填充不應成為可復原步驟（否則一次 Ctrl+Z 會清空整個主軸）。
    history.clear()
  }
})
</script>

<template>
  <section
    ref="rotationBoardRef"
    class="rotation-board"
    :class="{ 'rotation-board--lane-dragging': laneDrag.active }"
    :style="{ '--board-header-width': headerWidthPx + 'px' }"
    :[DELETE_ZONE_ATTRIBUTE]="true"
    aria-label="輸出軸面板"
  >
    <div ref="boardScrollRef" class="board__scroll">
      <!-- 泳道依 orderedSlots（laneOrder）排列；TransitionGroup 讓放開後的
           重排平滑滑動（move 過渡）。key 用 slotIndex（與 entries/欄位無關）。 -->
      <TransitionGroup tag="div" class="board__lanes" name="lane">
        <Swimlane
          v-for="slot in orderedSlots"
          :key="slot.slotIndex"
          :slot-index="slot.slotIndex"
          :character="slot.character"
          :entries="entriesBySlot[slot.slotIndex]"
          :grid-template="previewGridTemplate"
          :id-to-column-index="previewIdToColumn"
          :placeholder-column="previewLayout.placeholderColumn"
          :preview-slot-index="previewLayout.slotIndex"
          :dragging-as-source="laneDrag.active && laneDrag.slotIndex === slot.slotIndex"
          @lane-drag-start="onLaneDragStart"
        />
      </TransitionGroup>
    </div>

    <!-- 泳道拖曳浮起分身：橫向滿版的帶狀，跟游標垂直移動 -->
    <div
      v-if="laneDrag.active"
      class="lane-drag-clone"
      :style="{ top: laneDrag.cloneTop + 'px', width: laneDrag.cloneWidth + 'px', height: laneDrag.cloneHeight + 'px' }"
      aria-hidden="true"
    >
      <span class="lane-drag-clone__bar" :style="{ backgroundColor: laneDrag.cloneColor }" />
      <span class="lane-drag-clone__name">{{ laneDrag.cloneName }}</span>
      <span v-if="laneDrag.cloneElement" class="lane-drag-clone__el" :style="{ color: laneDrag.cloneColor }">
        {{ laneDrag.cloneElement }}
      </span>
    </div>

    <!-- 泳道落點插入提示線 -->
    <div
      v-if="laneDrag.active && laneDrag.lineTop != null"
      class="lane-insert-line"
      :style="{ top: laneDrag.lineTop + 'px' }"
      aria-hidden="true"
    />

    <div ref="measurerRef" class="board__measurer" aria-hidden="true">
      <BlockChip
        v-for="entry in rotationStore.entries"
        :key="entry.id"
        :label="measurerLabel(entry)"
        :color="entry.block.color || measurerColor(entry)"
      />
    </div>

    <!-- 側邊欄多選拖曳時，量測整組來源模板寬度（合計後供落點空欄寬度用）。
         僅在多選拖曳期間有內容；color 不影響寬度，量 label 即可。 -->
    <div ref="draggingGroupMeasurerRef" class="board__measurer" aria-hidden="true">
      <BlockChip
        v-for="(b, i) in dragState.draggingSourceBlocks"
        :key="i"
        :label="b.label"
        :color="b.color"
      />
    </div>

    <!-- 框選矩形（fixed，視窗座標）-->
    <div
      v-if="marquee.active"
      class="marquee-box"
      :style="{ left: marquee.left + 'px', top: marquee.top + 'px', width: marquee.width + 'px', height: marquee.height + 'px' }"
      aria-hidden="true"
    />
  </section>
</template>

<style scoped>
/* ── 三軸容器 ────────────────────────────────────────────── */
.rotation-board {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;

  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 6px;
  overflow: hidden;

  background: rgba(255, 255, 255, 0.015);

  position: relative;
}

/* ── 共用水平捲動容器 ──────────────────────────────────────── */
.board__scroll {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.board__lanes {
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 100%;
  height: 100%;
}

/* 泳道拖曳進行中：整個面板游標呈抓取態 */
.rotation-board--lane-dragging {
  cursor: grabbing;
}

/* ── 泳道重排平滑滑動（TransitionGroup move）─────────────────── */
.lane-move {
  transition: transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* ── 泳道拖曳浮起分身 ─────────────────────────────────────────
   橫向滿版帶狀，跟游標垂直移動；半透明深底＋泳道色,左側色條＋角色名。 */
.lane-drag-clone {
  position: absolute;
  left: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  pointer-events: none;
  background: rgba(13, 19, 32, 0.88);
  border: 1px solid rgba(34, 211, 238, 0.5);
  border-radius: 4px;
  box-shadow: 0 10px 26px -6px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(1px);
}
.lane-drag-clone__bar {
  width: 3px;
  height: 1.25rem;
  border-radius: 2px;
  flex-shrink: 0;
}
.lane-drag-clone__name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  letter-spacing: 0.02em;
}
.lane-drag-clone__el {
  font-size: 0.5625rem;
  letter-spacing: 0.08em;
  opacity: 0.8;
}

/* ── 泳道落點插入提示線 ───────────────────────────────────────
   橫向滿版的發光細線，標示放開後來源泳道將插入的位置。 */
.lane-insert-line {
  position: absolute;
  left: 0;
  right: 0;
  /* 必須高於浮起分身（z-index 60），否則分身飄到落點附近會蓋住提示線 */
  z-index: 65;
  height: 0;
  border-top: 2px solid rgba(34, 211, 238, 0.95);
  box-shadow: 0 0 8px 1px rgba(34, 211, 238, 0.7);
  pointer-events: none;
  transform: translateY(-1px);
  transition: top 0.12s ease;
}

/* ── 隱藏量測列 ────────────────────────────────────────────── */
.board__measurer {
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  pointer-events: none;
  display: flex;
  gap: 0.375rem;
}

/* ── 框選矩形（marquee） ────────────────────────────────────── */
.marquee-box {
  position: fixed;
  z-index: 900;
  pointer-events: none;
  border: 1px solid rgba(34, 211, 238, 0.7);
  background: rgba(34, 211, 238, 0.12);
  border-radius: 2px;
}
</style>

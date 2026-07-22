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
import HotkeyModeOverlay from '@/components/rotation/HotkeyModeOverlay.vue'
import { useHotkeyInputMode } from '@/composables/state/useHotkeyInputMode'
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
import { DELETE_ZONE_ATTRIBUTE, NEUTRAL_ZONE_ATTRIBUTE, useBlockDrag } from '@/composables/useBlockDrag'
import { getElementColor } from '@/constants/elements'
import { elementDisplayName } from '@/i18n'
import { useSettings } from '@/composables/state/useSettings'
import { prefersReducedMotion } from '@/utils/reducedMotion'
import type { SlotIndex } from '@/types/character'
import type { RotationEntry } from '@/types/rotation'

// ── Stores ───────────────────────────────────────────────────

const characterStore = useCharacterStore()
const rotationStore = useRotationStore()
const { laneOrder } = useLaneOrder()
const { dragState, notifyAutoScroll } = useBlockDrag()
const history = useHistory()

// 熱鍵輸入模式：面板右上角進入鈕 ＋ active 時掛 overlay（控制列/滾輪切泳道）。
const hotkeyMode = useHotkeyInputMode()

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

// 量測列用的 label：編輯中的區塊改用「即時草稿」而非已提交 label，使欄寬隨輸入
// 即時重算（區塊即時變寬、鄰塊即時順延）。多選同步編輯的其餘批次成員只在
// 「實際打字後」（editingDraftDirty）改量草稿——與 Swimlane.displayLabel 的
// 鏡射門檻一致，進入編輯瞬間各成員維持原字原寬。
function measurerLabel(entry: RotationEntry): string {
  if (entry.id === rotationStore.editingId) return rotationStore.editingDraft
  if (rotationStore.editingDraftDirty && rotationStore.editingBatchIds.includes(entry.id)) {
    return rotationStore.editingDraft
  }
  return entry.block.label
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
  draggingGroupWidth.value = ws.reduce((a, b) => a + b, 0) + TRACK_GAP.value * (ws.length - 1)
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

// 區塊間距：與 Swimlane 的 --track-gap / 匯出視圖共用單一來源（設定 trackGapPx），
// 把「欄序」換算成像素 x 位移（FLIP 平滑順延、落點寬度加總）時幾何模型與渲染一致。
// 設定改動時此 computed 更新 → previewLayout 等相依運算自動重算。
const { settings } = useSettings()
const TRACK_GAP = computed<number>(() => settings.value.trackGapPx)

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
  const isRotationSource = dragState.sourceType === 'rotation-instance'
  // 主軸區塊「已明確拖到三泳道外（無效區）」時，讓被拖區塊的原欄收合（不留空隙）。
  // 只在 isOverInvalidZone 為真時才收合——不在剛抓起（尚未移動）或掠過邊界時觸發，
  // 否則抓起瞬間整塊 board 立即重排＝畫面閃爍(issue1)、且 scrollWidth 縮短使 scrollLeft
  // 被夾回而畫面往左跳(issue2)。真正拖出泳道才收合，對應原始「拖到泳道外原位誤展開」需求。
  const collapsingDraggedOnly =
    dragState.isDragging && isRotationSource && dragState.isOverInvalidZone && !isPreviewing.value

  // 非拖曳、或（側邊欄來源且不在合法落點）：維持靜止佈局、不做動畫。
  if (!isPreviewing.value && !collapsingDraggedOnly) {
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
  const draggingId = dragState.draggingId

  const draggingIds = dragState.draggingIds
  const idSet = new Set<string>(draggingIds.length ? draggingIds : draggingId ? [draggingId] : [])

  const cols = entries.map((e, i) => ({ id: e.id, width: widths[i] ?? 0 }))

  // 只有在合法落點（isPreviewing）才插入落點空欄；拖到泳道外只收合被拖欄、不放空欄。
  if (isPreviewing.value) {
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
      if (cnt > 0) placeholderWidth = sum + TRACK_GAP.value * (cnt - 1)
    }
    const afterIn = dragState.previewInsertAfterIndex as number
    const insertAt = afterIn < 0 ? 0 : Math.min(afterIn + 1, cols.length)
    cols.splice(insertAt, 0, { id: PREVIEW_PLACEHOLDER, width: placeholderWidth })
  }

  const working = isRotationSource ? cols.filter((c) => !idSet.has(c.id)) : cols

  const idToColumn = new Map<string, number>()
  const idToX = new Map<string, number>()
  let x = 0
  working.forEach((c, i) => {
    idToColumn.set(c.id, i)
    idToX.set(c.id, x)
    x += c.width + TRACK_GAP.value
  })
  const template = working.map((c) => `${c.width}px`).join(' ')

  return {
    template,
    idToColumn,
    // 一律提供 idToX 給 FLIP：進出無效區的收合／展開都走平滑滑動，避免「從無效區拖回
    // 泳道時 grid-column 瞬間展開」。收合已收窄到 isOverInvalidZone 才觸發（穩定區域、
    // 非每幀切換），故不會像先前廣義 !isPreviewing 那樣反覆 toggle 造成整塊 board 晃動。
    idToX,
    placeholderColumn: idToColumn.get(PREVIEW_PLACEHOLDER) ?? null,
    // 拖到泳道外（僅收合）時不指定 slot，落點空欄不顯示。
    slotIndex: isPreviewing.value ? dragState.previewSlotIndex : null,
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
    x += (columnWidths.value[i] ?? 0) + TRACK_GAP.value
  })
  return m
}

function runFlip(newX: Map<string, number> | null): void {
  if (prefersReducedMotion()) return
  if (!dragState.isDragging) {
    _flipPrevX = null
    return
  }
  // 拖曳中但無預覽佈局（如側邊欄來源懸停禁區 → idToX 為 null，畫面回到靜止佈局）：
  // 以「靜止佈局位置」作為新佈局照常做 FLIP——進禁區時收合平滑滑回、
  // 再入泳道時 prev 基準也正確（若清空基準會被當拖曳首幀跳過動畫 → 瞬移）。
  const targetX = newX ?? restingIdToX()
  const prev = _flipPrevX
  _flipPrevX = targetX
  if (!prev) return // 拖曳首幀：只記基準，不動畫
  const root = boardScrollRef.value
  if (!root) return
  for (const [id, nx] of targetX) {
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
const boardContentRef = ref<HTMLElement | null>(null)

// 拖曳邊緣自動捲動：每次實際捲動後重算拖曳落點
const autoScroll = useEdgeAutoScroll(boardScrollRef, notifyAutoScroll)

// ── 欄收合時的最右端捲動保護（sticky header 抖動修正）─────────
// 欄收合（刪除/拖出/文字變短）使 scrollWidth 縮短、且已捲到最右時，瀏覽器會
// 自行把 scrollLeft「夾回」合法範圍；但 Blink 的自動夾回與 sticky header 重定位
// 分屬不同渲染階段 → header 先隨內容位移一幀才歸位（實測夾回後 header 偏左
// 15px，須等下次捲動/渲染才校正）＝泳道 header 抖動。
// 對策：不讓瀏覽器夾回。內容縮水的 DOM 更新落地後、任何強制排版讀取「之前」，
// 先以 min-width 撐住舊內容寬（scrollLeft 全程合法 → 自動夾回不觸發），改用
// 程式化捲動把畫面移到新的最右端（與使用者捲動同路徑，sticky 同幀更新、不抖），
// 下一幀再釋放 min-width——此時 scrollLeft 恰等於新 max，寬度縮回不造成偏移變化。
let _preShrink: { scrollLeft: number; clientWidth: number } | null = null

// 'pre'：DOM 尚未更新，先記下縮水前的捲動狀態（此時讀取不會觸發夾回）。
watch(previewGridTemplate, () => {
  const scroll = boardScrollRef.value
  if (!scroll) return
  _preShrink = { scrollLeft: scroll.scrollLeft, clientWidth: scroll.clientWidth }
}, { flush: 'pre' })

// 'post'：DOM 已更新但瀏覽器尚未排版——先撐寬、再量測、再程式化捲動。
watch(previewGridTemplate, () => {
  const scroll = boardScrollRef.value
  const content = boardContentRef.value
  const prev = _preShrink
  _preShrink = null
  if (!scroll || !content || !prev) return

  // 步驟一：任何版面讀取之前先撐住舊寬度（純寫入，不觸發排版）。
  content.style.minWidth = `${prev.scrollLeft + prev.clientWidth}px`

  // 步驟二：量測「自然」內容寬（此次強制排版帶著撐寬，offset 合法、不會夾回）。
  // 泳道群為 flex 子項（不被父層 min-width 拉伸），gBCR 即自然寬；尾端留白恆 50cqw。
  const lanesW = content.querySelector('.board__lanes')?.getBoundingClientRect().width ?? 0
  const naturalMax = Math.max(0, lanesW + prev.clientWidth * 0.5 - scroll.clientWidth)

  if (scroll.scrollLeft > naturalMax) {
    // 步驟三：程式化捲動到新的最右端（正常捲動路徑，sticky 與偏移同幀一致）。
    scroll.scrollLeft = naturalMax
    // 步驟四：下一幀釋放撐寬。此時 offset === 新 max，縮回不產生任何偏移變化。
    requestAnimationFrame(() => {
      content.style.minWidth = ''
    })
  } else {
    content.style.minWidth = ''
  }
}, { flush: 'post' })

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

// 跨三泳道矩形框選：與區塊拖曳徹底隔離（拖曳中停用；命中結果寫入選取）。
// 框選進行中同樣啟用邊緣自動捲動（游標靠容器左右緣即捲動），每捲一步
// 重算框選矩形——錨點釘在內容上，捲動時選取範圍隨之擴大到新露出的區塊。
const { marquee, refreshRect: refreshMarqueeRect } = useMarquee({
  enabled: () => !dragState.isDragging,
  onSelect: (ids, additive) => rotationStore.selectBlocks(ids, additive),
  scrollLeft: () => boardScrollRef.value?.scrollLeft ?? 0,
  onActiveChange: (active) => (active ? marqueeAutoScroll.start() : marqueeAutoScroll.stop()),
})

// 框選專用的邊緣捲動實例（與拖曳實例分開，start/stop 生命週期互不干擾）
const marqueeAutoScroll = useEdgeAutoScroll(boardScrollRef, () => refreshMarqueeRect())

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

// ── 泳道選取焦點環（W/S 巡覽）────────────────────────────────
// 選取視覺不掛在各 Swimlane 上，改由單一絕對定位覆蓋層承載：切換泳道時
// 焦點環以 top 補間從舊泳道「滑動」到新泳道（主機式焦點導航），而非
// 舊框消失、新框瞬現的跳格感。位置以選中 Swimlane 的 offsetTop/Height 量得
// （offsetParent＝.board__content，需 position:relative）。
// 首次出現（無舊位置可滑）與減少動態時直接落位，僅淡入。
// 淡入淡出不用 <Transition>（隱藏分頁暫停 rAF 會卡住 enter class），改為
// 元素常駐＋visible class 的純 CSS opacity 過渡；取消選取時保留最後位置淡出。
const laneRing = ref<{ top: number; height: number } | null>(null)
const laneRingVisible = ref(false)
const laneRingNoSlide = ref(false)

watch(
  [() => rotationStore.selectedLaneIndex, laneOrder],
  ([lane]) => {
    if (lane === null) {
      laneRingVisible.value = false
      return
    }
    const el = boardContentRef.value?.querySelector<HTMLElement>(`.swimlane--slot-${lane}`)
    if (!el) {
      laneRingVisible.value = false
      return
    }
    laneRingNoSlide.value = !laneRingVisible.value || prefersReducedMotion()
    laneRing.value = { top: el.offsetTop, height: el.offsetHeight }
    laneRingVisible.value = true
  },
  { flush: 'post' },
)

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
    :aria-label="$t('board.panelLabel')"
  >
    <div ref="boardScrollRef" class="board__scroll">
      <!-- 橫向內容列：泳道群 + 尾端留白佔位（讓末端區塊可捲至畫面中央）。 -->
      <div ref="boardContentRef" class="board__content">
        <!-- 泳道選取焦點環：置於泳道群「之前」，使泳道內的定位元素（區塊、
             sticky header）在繪製順序上蓋過焦點環——維持原本「輝光在區塊後方」
             的層次。top 補間滑動至選中泳道；淡入/淡出以 visible class 驅動。 -->
        <div
          v-if="laneRing"
          class="lane-focus-ring"
          :class="{
            'lane-focus-ring--visible': laneRingVisible,
            'lane-focus-ring--no-slide': laneRingNoSlide,
          }"
          :style="{ top: laneRing.top + 'px', height: laneRing.height + 'px' }"
          aria-hidden="true"
        />
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

        <!-- 尾端留白佔位：純佔位、不可互動（中立區＝拖曳鬆手一律彈回，非落點非刪除區）。 -->
        <div class="board__end-spacer" :[NEUTRAL_ZONE_ATTRIBUTE]="true" aria-hidden="true" />
      </div>
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
        {{ elementDisplayName(laneDrag.cloneElement) }}
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

    <!-- 熱鍵輸入模式：右上角進入鈕（模式中隱藏，退出由 overlay 控制列負責） -->
    <button
      v-if="!hotkeyMode.active.value"
      type="button"
      class="hotkey-mode-trigger"
      :title="$t('hotkey.triggerTitle')"
      :aria-label="$t('hotkey.triggerLabel')"
      @click.stop="hotkeyMode.enter()"
    >⌨ {{ $t('hotkey.triggerText') }} <kbd>F</kbd></button>

    <!-- 熱鍵輸入模式覆蓋層（控制列＋滾輪切泳道；區塊插入由全域 keydown 分派） -->
    <HotkeyModeOverlay v-if="hotkeyMode.active.value" />

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
  /* 內容增刪時停用瀏覽器「捲動錨定」自動調整捲動位置：錨定補償與 sticky header
     重定位不同步，是欄收合時 header 抖動的另一來源；捲動位置一律由本元件掌控。 */
  overflow-anchor: none;
  /* 宣告為容器查詢容器：讓尾端留白與泳道最小寬能以 cqw（可視寬度）定尺寸，
     捲動內容再寬，cqw 仍以「可視視窗寬」為基準（scrollWidth 不影響）。 */
  container-type: inline-size;
}

/* 橫向內容列：泳道群（撐滿可視寬、可再被內容撐寬）＋ 尾端留白佔位。 */
.board__content {
  position: relative; /* 泳道焦點環的定位基準（offsetParent） */
  display: flex;
  flex-direction: row;
  width: max-content;
  height: fit-content;
}

/* ── 泳道選取焦點環（W/S 巡覽）────────────────────────────────
   視覺沿用原 .swimlane--lane-selected（青色邊框＋淡底＋內輝光），改為單一
   覆蓋層以便在泳道間平滑滑動。右緣內縮 50cqw＝扣掉尾端留白，恰貼齊泳道
   群右緣；pointer-events 穿透不擋任何互動。 */
.lane-focus-ring {
  position: absolute;
  left: 0;
  right: 50cqw;
  pointer-events: none;
  /* 滑動補間刻意用 top 而非 transform：transform 會使本體形成 stacking
     context，把 ::after 的 z-index 困在內、永遠壓不過 header（z:5）。
     單一小元素的 top 過渡（220ms）布局成本可忽略。 */
  transition:
    top 0.22s cubic-bezier(0.22, 0.61, 0.36, 1),
    height 0.22s cubic-bezier(0.22, 0.61, 0.36, 1);
}
/* 視覺拆到兩個偽元素、各自淡入淡出（本體恆 opacity:1——若在本體做整體
   淡入，opacity<1 會使本體形成 stacking context，::after 的 z-index 被困在
   內、壓不過 header，淡入完成瞬間邊框才跳到 header 上＝新的閃爍）：
   - ::before：底色＋內輝光，z 維持在 sticky header（z:5）之下，
     保持「輝光在區塊/header 後方」的原層次。
   - ::after：整圈邊框，z 抬到 6＝header 之上——邊框（含 header 段）連續
     繪製，滑動經過 header 與軌道的接縫不再被不透明 header 蓋掉一截而閃爍。
     與拖曳把手同層但 DOM 較早 → 把手/取消鈕仍在上。
     能壓過 header 的前提：.swimlane 及其祖先鏈不形成 stacking context。 */
.lane-focus-ring::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(34, 211, 238, 0.07);
  box-shadow: inset 0 0 16px rgba(34, 211, 238, 0.18);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.lane-focus-ring::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 6;
  outline: 1.5px solid #67E8F9;
  outline-offset: -3px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.lane-focus-ring--visible::before,
.lane-focus-ring--visible::after {
  opacity: 1;
}
/* 首次出現／減少動態：位置直接落位（不滑動）；偽元素的淡入淡出不受影響 */
.lane-focus-ring--no-slide {
  transition: none;
}

.board__lanes {
  display: flex;
  flex-direction: column;
  width: max-content;
  /* 至少填滿可視寬度（原 min-width:100%；改 cqw 因外層多包一層 flex，
     100% 會含尾端留白而失真）。內容超出時仍由 max-content 撐寬。 */
  min-width: 100cqw;
  /* 高度自適應（泳道為固定高、不依賴父高）：使本容器剛好包住三泳道，
     下方空白改由 .board__scroll 承載。導覽 step6/8 即以此元素精準聚焦三泳道。 */
  height: fit-content;
}

/* 尾端留白佔位：恆佔可視寬的一半，讓最末區塊能捲到畫面中央。
   純佔位、不可互動：掛 data-neutral-zone（拖曳鬆手一律彈回，非落點非刪除區），
   無任何視覺（透明），高度隨 flex stretch 貼齊三泳道帶。 */
.board__end-spacer {
  flex: 0 0 50cqw;
}

/* 泳道拖曳進行中：整個面板游標呈抓取態 */
.rotation-board--lane-dragging {
  cursor: grabbing;
}

/* 泳道拖曳進行中：所有泳道 header 一律穿透。
   浮起分身跟游標垂直移動、經過其他泳道 sticky header 上方時，滑鼠 hover 會
   誤觸角色頭像發光框與「取消選角」鈕浮現；拖曳期間全數禁止互動（比照
   區塊拖曳的 .swimlane__header--drag-inert）。 */
.rotation-board--lane-dragging :deep(.swimlane__header) {
  pointer-events: none;
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

/* ── 熱鍵輸入模式進入鈕：第三條泳道正下方、靠左貼齊 header 區 ───
   top 寫死＝3 × 泳道高（Swimlane 的 --lane-height: 4rem）＋間距；泳道恆為
   三條固定高，若日後改動泳道高度須同步調整。定位在 .rotation-board（非捲動
   內容）上 → 不隨橫向捲動移動。 */
.hotkey-mode-trigger {
  position: absolute;
  top: calc(3 * 4rem + 0.6rem);
  left: 0.75rem;
  z-index: 55;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid rgba(34, 211, 238, 0.45);
  border-radius: 4px;
  background-color: rgba(13, 19, 32, 0.85);
  color: rgba(34, 211, 238, 0.95);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.hotkey-mode-trigger:hover {
  background-color: rgba(34, 211, 238, 0.16);
  border-color: rgba(34, 211, 238, 0.7);
}
.hotkey-mode-trigger:focus {
  outline: none;
}
.hotkey-mode-trigger:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.6);
  outline-offset: 1px;
}
.hotkey-mode-trigger kbd {
  padding: 0 0.3em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.625rem;
  line-height: 1.5;
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 3px;
  background: rgba(34, 211, 238, 0.1);
}

/* ── 框選矩形（marquee） ────────────────────────────────────── */
.marquee-box {
  position: fixed;
  /* 低於側邊欄（z:40）與收合鈕（z:50）：邊緣自動捲動使矩形左緣越過主軸
     左緣時，從不透明側欄底下穿過（視覺上自然延伸出畫面）。仍高於主軸
     內容——區塊/sticky header 都困在 .board__scroll 的 stacking context
     （contain 所致，z:auto）內，任何正 z 皆可壓過。 */
  z-index: 30;
  pointer-events: none;
  border: 1px solid rgba(34, 211, 238, 0.7);
  background: rgba(34, 211, 238, 0.12);
  border-radius: 2px;
}
</style>

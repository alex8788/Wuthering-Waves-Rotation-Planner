<script setup lang="ts">
// ============================================================
// RotationBoard.vue
// 主時間軸面板：三條 Swimlane 的總容器。
//
// 職責：
//   1. 從 useCharacterStore 讀取三個角色槽的選角狀態。
//   2. 從 useRotationStore 讀取 1D 輸出軸陣列（entries）。
//   3. 將 1D 陣列依 slotIndex 過濾，分別傳入對應的 Swimlane。
//   4. 假資料驗證：初始化時注入測試用 RotationEntry，確認 Store 資料能正確渲染到泳道。
//
// 版面結構：
//   ┌──────────────────────────────────────────────┐
//   │  Swimlane (slotIndex = 0)                    │
//   ├──────────────────────────────────────────────┤
//   │  Swimlane (slotIndex = 1)                    │
//   ├──────────────────────────────────────────────┤
//   │  Swimlane (slotIndex = 2)                    │
//   └──────────────────────────────────────────────┘
//
// 嚴格限制：
//   本元件為靜態殼層，不處理拖曳邏輯。
//   所有渲染邏輯限於「讀取 store → 分配資料 → 傳入 Swimlane」三步驟。
// ============================================================

import { computed, onMounted, onBeforeUnmount, nextTick, ref, watch } from 'vue'
import Swimlane from '@/components/rotation/Swimlane.vue'
import BlockChip from '@/components/ui/BlockChip.vue'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useRotationStore } from '@/stores/useRotationStore'
import { DELETE_ZONE_ATTRIBUTE, useBlockDrag } from '@/composables/useBlockDrag'
import type { SlotIndex } from '@/types/character'
import type { RotationEntry } from '@/types/rotation'

// ── Stores ───────────────────────────────────────────────────

const characterStore = useCharacterStore()
const rotationStore  = useRotationStore()
const { dragState, setColumnBaseline } = useBlockDrag()

// ── Computed：依 slotIndex 分配 entries ─────────────────────

/**
 * entriesBySlot：將 1D 陣列依 slotIndex 過濾成三份子陣列。
 *
 * 設計說明：
 *   三條泳道的過濾結果來自同一個 computed，避免三個各自獨立的
 *   computed 對 entries 做三次全量掃描。
 *   使用 Map 讓分組一次完成，整體為 O(N)。
 */
const entriesBySlot = computed<Record<SlotIndex, RotationEntry[]>>(() => {
  const map: Record<SlotIndex, RotationEntry[]> = { 0: [], 1: [], 2: [] }
  for (const entry of rotationStore.entries) {
    map[entry.slotIndex as SlotIndex].push(entry)
  }
  return map
})

// ── 單線程欄位對齊（共用 CSS Grid）────────────────────────────
//
// 三條泳道各自只渲染「自己的真實區塊」，但縱向必須對齊到同一條全域序列的欄位。
// 作法：量出每個全域區塊的固有像素寬，組成一份共用的 grid-template-columns，
// 三條泳道共用；每個真實區塊用 grid-column 放到它的全域欄位，未被佔用的欄自然留白。

/** entryId → 全域 0-based 欄位序，供各泳道以 grid-column 定位（一次 O(N) 建好） */
const idToColumnIndex = computed<Map<string, number>>(() => {
  const map = new Map<string, number>()
  rotationStore.entries.forEach((entry, index) => map.set(entry.id, index))
  return map
})

/** 量測列的 fallback 顏色（顏色不影響寬度，僅求穩） */
function measurerColor(entry: RotationEntry): string {
  return characterStore.slotCharacters[entry.slotIndex]?.themeColor ?? '#888888'
}

// 隱藏量測列：用真實 BlockChip 量出每個全域區塊的固有寬度（依 label 文字 + 字體）
const measurerRef = ref<HTMLElement | null>(null)
const columnWidths = ref<number[]>([])

/** grid-template-columns 字串；三條泳道共用 */
const gridTemplate = computed<string>(() =>
  columnWidths.value.map((w) => `${w}px`).join(' '),
)

function measure(): void {
  const el = measurerRef.value
  if (!el) return
  // getBoundingClientRect 取小數寬度，避免次像素累積導致欄位逐漸偏移
  columnWidths.value = Array.from(el.children).map(
    (child) => (child as HTMLElement).getBoundingClientRect().width,
  )
}

async function remeasureAfterRender(): Promise<void> {
  await nextTick()
  measure()
}

// 全域序列變動（新增/刪除/移動/改文字）後重新量測
watch(() => rotationStore.entries, remeasureAfterRender, { deep: true })

// 拖曳開始時，快照「靜態欄位幾何」給 useBlockDrag 做落點 hit-test（主軸與側邊欄皆用）。
// 同步讀取（不 await nextTick）：watch 'pre' flush 時 DOM 仍是拖曳前佈局（被拖區塊尚未因
// isDragging 重渲染成 hidden），故能量到含被拖在內的完整欄位中心。之後 hit-test 全程用此
// 快照、不再讀即時 DOM，不受預覽擠出造成的 layout 位移影響（修 p10-1 飄忽，含側邊欄來源）。
watch(
  () => dragState.isDragging,
  (now) => {
    if (!now) return
    const centerById = new Map<string, number>()
    document.querySelectorAll<HTMLElement>('.rotation-block[data-entry-id]').forEach((el) => {
      const id = el.getAttribute('data-entry-id')
      if (!id) return
      const r = el.getBoundingClientRect()
      centerById.set(id, r.left + r.width / 2)
    })
    // 含全部 entries、依全域順序，左→右
    const baseline = rotationStore.entries.map((e) => ({
      id: e.id,
      center: centerById.get(e.id) ?? Infinity,
    }))
    setColumnBaseline(baseline)
  },
)

// ── 拖曳落點預覽（single thread 跨泳道同步擠出）──────────────────
//
// 拖曳中於落點欄「同步空出一欄」：在共用 grid 上重算欄寬與每個 block 的欄序，
// 三泳道因共用同一份 template 而一起擠出 → 達成「column 視為整體」。
// 落點由 useBlockDrag 的 previewInsertAfterIndex（全域 after-index）驅動。

const PREVIEW_PLACEHOLDER = '__preview_placeholder__'

const isPreviewing = computed<boolean>(
  () => dragState.isDragging && dragState.previewInsertAfterIndex !== null,
)

/**
 * previewLayout：拖曳預覽下的「顯示欄位」描述。
 *  - 非預覽：回退原始 gridTemplate / idToColumnIndex。
 *  - 預覽：主軸來源先收合被拖區塊原欄，再於落點插入一欄（寬＝被拖寬度），重算欄序。
 */
const previewLayout = computed<{
  template: string
  idToColumn: Map<string, number>
  placeholderColumn: number | null
  slotIndex: SlotIndex | null
}>(() => {
  if (!isPreviewing.value) {
    return {
      template: gridTemplate.value,
      idToColumn: idToColumnIndex.value,
      placeholderColumn: null,
      slotIndex: null,
    }
  }

  const entries = rotationStore.entries
  const widths = columnWidths.value
  const afterIn = dragState.previewInsertAfterIndex as number // 含全部 entries 的全域 after-index
  const draggingId = dragState.draggingId
  const isRotationSource = dragState.sourceType === 'rotation-instance'

  // 被拖區塊集合（多選＝整組；單選＝單一）。主軸來源才需收合原欄。
  const TRACK_GAP = 6 // 與 .track__inner / .track__draggable 的 --track-gap（0.375rem）一致
  const draggingIds = dragState.draggingIds
  const idSet = new Set<string>(draggingIds.length ? draggingIds : draggingId ? [draggingId] : [])

  // 落點空欄寬度：多選＝各選中欄寬加總（含其間 gap），讓「解壓縮」插入的預留空間貼近實際；
  // 否則沿用 draggingWidth（單選被拖欄寬 / 側邊欄浮動分身寬）。
  let placeholderWidth = dragState.draggingWidth
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

  // 先在「含全部」序列的 afterIn+1 插入落點空欄，再（主軸來源）收合所有被拖欄。
  // 先插後收合可保證落點與被拖欄的相對位置正確，且 afterIn 與 store moveBlock(s) 語意一致。
  const cols = entries.map((e, i) => ({ id: e.id, width: widths[i] ?? 0 }))
  const insertAt = afterIn < 0 ? 0 : Math.min(afterIn + 1, cols.length)
  cols.splice(insertAt, 0, { id: PREVIEW_PLACEHOLDER, width: placeholderWidth })
  const working = isRotationSource ? cols.filter((c) => !idSet.has(c.id)) : cols

  // (c) 重算欄序與 template
  const idToColumn = new Map<string, number>()
  working.forEach((c, i) => idToColumn.set(c.id, i)) // 0-based（與原 idToColumnIndex 一致）
  const template = working.map((c) => `${c.width}px`).join(' ')

  return {
    template,
    idToColumn,
    placeholderColumn: idToColumn.get(PREVIEW_PLACEHOLDER) ?? null,
    // 落點泳道由 hit-test 直接記錄（主軸＝被拖泳道；側邊欄＝游標所在合法泳道）
    slotIndex: dragState.previewSlotIndex,
  }
})

const previewGridTemplate = computed<string>(() => previewLayout.value.template)
const previewIdToColumn = computed<Map<string, number>>(() => previewLayout.value.idToColumn)

// ── 跨三泳道矩形框選（marquee, 4.4e）──────────────────────────
// 在面板空白處按下拖出矩形，鬆手時選取所有與矩形相交的區塊（不分泳道）。
// 與既有拖曳互斥；按住 Ctrl/Meta 為累加選取。overlay 用 fixed（視窗座標），
// 與 clientX/Y 一致，免受捲動位移影響。

const marquee = ref<{ active: boolean; left: number; top: number; width: number; height: number }>({
  active: false, left: 0, top: 0, width: 0, height: 0,
})
let _mqStartX = 0
let _mqStartY = 0
let _mqAdditive = false
let _mqMoved = false
let _justMarqueed = false

function onBoardMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return
  if (dragState.isDragging) return
  // 只在空白處啟動：避開區塊、按鈕、輸入框、角色選單等互動元素
  const t = event.target as Element | null
  if (t?.closest('.rotation-block, button, input, [role="combobox"], .char-selector__listbox')) return

  _mqStartX = event.clientX
  _mqStartY = event.clientY
  _mqAdditive = event.ctrlKey || event.metaKey
  _mqMoved = false
  window.addEventListener('mousemove', onBoardMouseMove)
  window.addEventListener('mouseup', onBoardMouseUp)
}

function onBoardMouseMove(event: MouseEvent): void {
  const dx = event.clientX - _mqStartX
  const dy = event.clientY - _mqStartY
  // 小於閾值視為單純點擊，不啟動框選（交給原本的點擊清除選取）
  if (!_mqMoved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
  _mqMoved = true
  marquee.value = {
    active: true,
    left: Math.min(_mqStartX, event.clientX),
    top: Math.min(_mqStartY, event.clientY),
    width: Math.abs(dx),
    height: Math.abs(dy),
  }
}

function onBoardMouseUp(): void {
  window.removeEventListener('mousemove', onBoardMouseMove)
  window.removeEventListener('mouseup', onBoardMouseUp)

  if (_mqMoved) {
    const r = marquee.value
    const right = r.left + r.width
    const bottom = r.top + r.height
    const hit: string[] = []
    document.querySelectorAll<HTMLElement>('.rotation-block[data-entry-id]').forEach((el) => {
      const b = el.getBoundingClientRect()
      // 矩形相交（AABB）
      if (b.left < right && b.right > r.left && b.top < bottom && b.bottom > r.top) {
        const id = el.getAttribute('data-entry-id')
        if (id) hit.push(id)
      }
    })
    rotationStore.selectBlocks(hit, _mqAdditive)
    _justMarqueed = true // 抑制隨後冒泡到 app-root 的 click 清除選取
  }
  marquee.value = { active: false, left: 0, top: 0, width: 0, height: 0 }
}

// 框選剛結束時，攔截緊接的 click（避免 App.vue root @click 清掉剛選取的區塊）
function onBoardClickCapture(event: MouseEvent): void {
  if (_justMarqueed) {
    event.stopPropagation()
    _justMarqueed = false
  }
}

// ── 假資料初始化（Store 驗證用）────────────────────────────

/**
 * seedStoreWithStubData：
 *   在 onMounted 時向 rotationStore 注入假資料，
 *   驗證「Store → 過濾 → Swimlane 渲染」這條資料路徑是否正常。
 *
 *   條件：只在 store 為空時執行，避免重複注入或覆蓋使用者資料。
 *   後續 Phase 完成選角 UI 後可移除此函式。
 */
function seedStoreWithStubData(): void {
  if (rotationStore.entries.length > 0) return

  // 取得三個槽位的角色（可能為 null）
  const chars = characterStore.slotCharacters

  // 為每個有角色的槽位注入數個測試區塊
  const stubLabels = [
    ['A', '3AE', 'E', 'R', 'A'],   // slot 0
    ['E', 'Z',   'A', 'EQ'],        // slot 1
    ['3A', 'R',  'D', 'A', 'E'],   // slot 2
  ] as const

  stubLabels.forEach((labels, idx) => {
    const slotIndex = idx as SlotIndex
    const char = chars[idx]
    if (!char) return // 槽位無角色，跳過

    labels.forEach((label) => {
      rotationStore.addFreeformBlock(
        label,
        char.themeColor,
        slotIndex,
        char.id,
      )
    })
  })
}

function handleResize(): void {
  void remeasureAfterRender()
}

onMounted(async () => {
  // 角色改由各泳道 header 的 CharacterSelector 實際選入（4.4a）。
  // 開發模式才預選三角色並注入假區塊，方便即時驗證；正式環境啟動為空白面板。
  if (import.meta.env.DEV) {
    const slots = characterStore.slots
    if (!slots[0].character) characterStore.setCharacter(0, 'jiyan')
    if (!slots[1].character) characterStore.setCharacter(1, 'verina')
    if (!slots[2].character) characterStore.setCharacter(2, 'shorekeeper')

    seedStoreWithStubData()
  }

  // 首次量測：等假資料渲染進量測列後
  await remeasureAfterRender()
  // 字體（JetBrains Mono）載入後寬度會變，再量一次
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => void remeasureAfterRender())
  }
  window.addEventListener('resize', handleResize)
  // 框選起手用 window capture 監聽（見 onWindowMouseDown 註解）
  window.addEventListener('mousedown', onWindowMouseDown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('mousedown', onWindowMouseDown, true)
  // 卸載時若仍在框選，移除殘留的全域監聽
  window.removeEventListener('mousemove', onBoardMouseMove)
  window.removeEventListener('mouseup', onBoardMouseUp)
  window.removeEventListener('click', _suppressNextClick, true)
})
</script>

<template>
  <section
    class="rotation-board"
    :[DELETE_ZONE_ATTRIBUTE]="true"
    aria-label="輸出軸面板"
  >

    <!--
      共用水平捲動容器：三條泳道共用同一條捲軸，
      確保連招超寬、捲動時三泳道縱向欄位仍對齊（single thread 完整性）。
    -->
    <div class="board__scroll">
      <div class="board__lanes">
        <!--
          三條泳道：依 slotIndex 0 / 1 / 2 順序渲染。
          character 與 entries 皆從 store computed 中取得。
          grid-template / id-to-column-index 拖曳時改用「預覽版」以呈現跨泳道同步擠出。
        -->
        <Swimlane
          v-for="slot in characterStore.slots"
          :key="slot.slotIndex"
          :slot-index="slot.slotIndex"
          :character="slot.character"
          :entries="entriesBySlot[slot.slotIndex]"
          :grid-template="previewGridTemplate"
          :id-to-column-index="previewIdToColumn"
          :placeholder-column="previewLayout.placeholderColumn"
          :preview-slot-index="previewLayout.slotIndex"
        />
      </div>
    </div>

    <!--
      隱藏量測列：用真實 BlockChip 量出每個全域區塊的固有寬度，
      組成三條泳道共用的 grid-template-columns。絕對定位且 visibility:hidden，
      不影響版面也不參與互動。掛在非捲動容器上，定位最穩。
    -->
    <div ref="measurerRef" class="board__measurer" aria-hidden="true">
      <BlockChip
        v-for="entry in rotationStore.entries"
        :key="entry.id"
        :label="entry.block.label"
        :color="entry.block.color || measurerColor(entry)"
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

  /* 外框：與整體 UI 深色底的邊界 */
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 6px;
  overflow: hidden;           /* 讓第一/最後條 Swimlane 的 border-radius 生效 */

  background: rgba(255, 255, 255, 0.015);

  /* 量測列以此為定位基準 */
  position: relative;
}

/* ── 共用水平捲動容器 ────────────────────────────────────────
   唯一的橫向捲軸；三泳道改由內容撐寬並共用此捲動，捲動時對齊不破。 */
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

/* ── 隱藏量測列 ──────────────────────────────────────────────
   gap 必須與泳道軌道的 --track-gap（0.375rem）一致，否則量到的寬度會偏。
   只量每個 chip 自身寬度，gap 不影響逐欄寬度，但保持一致較不易出錯。 */
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

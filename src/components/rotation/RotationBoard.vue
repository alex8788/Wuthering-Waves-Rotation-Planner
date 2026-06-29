<script setup lang="ts">
// ============================================================
// RotationBoard.vue
// 主時間軸面板：三條 Swimlane 的總容器。
//
// 職責：
//   1. 讀 useCharacterStore 三個角色槽選角狀態。
//   2. 讀 useRotationStore 1D 輸出軸陣列（entries），依 slotIndex 分配給三條泳道。
//   3. 共用 CSS Grid 欄位對齊 + 拖曳落點預覽（含多選）。
//   4. 跨三泳道矩形框選（marquee）。
//
// 拖曳本身由各 Swimlane 內的 SortableJS 處理；本元件只負責框選，
// 且框選刻意與區塊拖曳完全隔離（見下方 marquee 區註解）。
// ============================================================

import { computed, onMounted, onBeforeUnmount, nextTick, reactive, ref, watch } from 'vue'
import Swimlane from '@/components/rotation/Swimlane.vue'
import BlockChip from '@/components/ui/BlockChip.vue'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useRotationStore } from '@/stores/useRotationStore'
import { useLaneOrder } from '@/composables/useLaneOrder'
import { DELETE_ZONE_ATTRIBUTE, useBlockDrag } from '@/composables/useBlockDrag'
import { getElementColor } from '@/constants/elements'
import type { SlotIndex } from '@/types/character'
import type { RotationEntry } from '@/types/rotation'

// ── Stores ───────────────────────────────────────────────────

const characterStore = useCharacterStore()
const rotationStore = useRotationStore()
const { laneOrder, setOrderByMove } = useLaneOrder()
const { dragState, notifyAutoScroll } = useBlockDrag()

// ── 泳道顯示順序 ─────────────────────────────────────────────
// 依 laneOrder 把 slots 重新排成「上下顯示順序」。slots 以 slotIndex 為索引，
// slots[si].slotIndex === si，故直接映射即可。entries / 欄位對齊全不受影響。
const orderedSlots = computed(() => laneOrder.value.map((si) => characterStore.slots[si]))

// ── 依 slotIndex 分配 entries ────────────────────────────────

const entriesBySlot = computed<Record<SlotIndex, RotationEntry[]>>(() => {
  const map: Record<SlotIndex, RotationEntry[]> = { 0: [], 1: [], 2: [] }
  for (const entry of rotationStore.entries) {
    map[entry.slotIndex as SlotIndex].push(entry)
  }
  return map
})

// ── 單線程欄位對齊（共用 CSS Grid）───────────────────────────

const idToColumnIndex = computed<Map<string, number>>(() => {
  const map = new Map<string, number>()
  rotationStore.entries.forEach((entry, index) => map.set(entry.id, index))
  return map
})

function measurerColor(entry: RotationEntry): string {
  return characterStore.slotCharacters[entry.slotIndex]?.themeColor ?? '#888888'
}

// 量測列用的 label：編輯中的區塊改用「即時草稿」而非已提交 label，
// 使欄寬隨輸入即時重算（編輯時區塊即時變寬、鄰塊即時順延）。
function measurerLabel(entry: RotationEntry): string {
  return entry.id === rotationStore.editingId ? rotationStore.editingDraft : entry.block.label
}

const measurerRef = ref<HTMLElement | null>(null)
const columnWidths = ref<number[]>([])

const gridTemplate = computed<string>(() =>
  columnWidths.value.map((w) => `${w}px`).join(' '),
)

function measure(): void {
  const el = measurerRef.value
  if (!el) return
  columnWidths.value = Array.from(el.children).map(
    (child) => (child as HTMLElement).getBoundingClientRect().width,
  )
}

async function remeasureAfterRender(): Promise<void> {
  await nextTick()
  measure()
}

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

watch(() => rotationStore.entries, remeasureAfterRender, { deep: true })
// 行內編輯草稿變動時也重新量測，讓編輯中的區塊即時變寬
watch(() => rotationStore.editingDraft, remeasureAfterRender)

// ── 拖曳落點預覽（single thread 跨泳道同步擠出，含多選）─────────

const PREVIEW_PLACEHOLDER = '__preview_placeholder__'

// 區塊間距（px），須與 Swimlane 的 --track-gap (0.375rem = 6px) 一致。
// 用於把「欄序」換算成「像素 x 位移」（FLIP 平滑順延）。
const TRACK_GAP = 6

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

// ── 拖曳「平滑順延」FLIP（方案B）──────────────────────────────
//
// grid-column 是離散屬性，CSS 無法補間 → 落點變動時其他區塊原本「瞬移」到隔壁欄，
// 拖快掠過多塊就像閃爍。此處於每次落點變動後，對欄序有變的區塊補一段 transform 滑動：
//   位移量＝(舊欄左緣x − 新欄左緣x)，純用 idToX（欄寬解析式）算出，全程不量 DOM →
//   不觸發 reflow，避開先前 TransitionGroup 的卡頓坑（見專案歷史）。
// 只動「非被拖」區塊的 transform；被拖本體/多選組已被排除在 idToX 外，浮動分身在
// <body> 而查詢範圍限定在 board 內 → 兩者都不會被碰到，不與 SortableJS 佔用的 transform 衝突。
const FLIP_MS = 140
let _flipPrevX: Map<string, number> | null = null
const _reducedMotion =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
  if (_reducedMotion) return
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

// ── 跨三泳道矩形框選（marquee）─────────────────────────────
//
// 與區塊拖曳徹底隔離，避免互搶事件：
//   1. 起手只在 .board__scroll 上掛「冒泡階段」mousedown（非 window capture），
//      不會搶在 SortableJS 之前；且區塊的 mousedown 一律先被 SortableJS 處理。
//   2. 按在區塊/按鈕/輸入框/選單上 → 直接 return，完全不介入，由 SortableJS
//      獨佔該次拖曳；空白處 SortableJS 本來就不啟動 → 兩者互不干擾。
//   3. 左鍵按住後，位移超過閾值才真正啟動框選（單純點擊不框選）。
//   4. 框選進行中才掛 window mousemove/mouseup，結束立即移除。

const boardScrollRef = ref<HTMLElement | null>(null)

// ── 拖曳邊緣自動捲動（4.4f）─────────────────────────────────
//
// 拖曳中游標「超出」.board__scroll 左/右邊緣時，RAF 迴圈持續修改 scrollLeft。
// 只動 scrollLeft（不重開 SortableJS scroll、不動浮動分身）；落點正確性由
// notifyAutoScroll(delta) 同步補償 _columnBaseline 並重算（見 useBlockDrag）。
//
// 觸發改為「游標抵達容器邊緣外緣」而非舊版邊緣內側 48px 寬帶（舊版游標還在泳道內就捲動）。
// 兩側觸發位置不對稱，故速度模型也不同（但體感都是「慢→快」）：
//   ‧ 右側：邊界＝視窗右緣（一道物理牆，游標被夾在 innerWidth-1）。EDGE_TOL 補償 off-by-one
//     與子像素。游標頂著牆，採「時間式」二次方加速（停留越久越快）。
//   ‧ 左側：邊界＝泳道 header 右緣，位於畫面中段、左方為開放空間（無牆）。改採「距離式」緩衝：
//     剛越過 header 右緣最慢，游標越往左推（越接近畫面左緣）越快，LEFT_RAMP_PX 為加速到頂的距離。
const EDGE_TOL = 4        // 右側視為「超出範圍」的容差（px）
const LEFT_RAMP_PX = 140  // 左側：游標越過 header 右緣多遠時加速到頂（px）＝緩衝帶寬度
const MIN_STEP = 4        // 剛進入觸發區的起始速度（px/幀）
const MAX_STEP = 20       // 加速到頂的速度（px/幀）
const ACCEL_MS = 1000     // 右側：從 MIN_STEP 漸進加速到 MAX_STEP 所需的停留時間(ms)
let _rafId = 0
let _edgeClientX = Number.NaN  // 尚未收到 mousemove 前為 NaN → 下方比較皆 false → 不捲動
let _accelStart = 0            // 右側時間式加速的起始時間戳（0 = 目前不在右側觸發區）

function onDragMouseMove(event: MouseEvent): void {
  _edgeClientX = event.clientX
}

function autoScrollTick(): void {
  const el = boardScrollRef.value
  if (el) {
    const rect = el.getBoundingClientRect()
    // 左界用泳道 sticky header 的右緣：header 蓋在軌道左側（sticky left:0、z-index:5），
    // 視覺上的軌道左邊界＝header 右緣，而非 board 左緣。游標移到 header 右緣以左即往左捲。
    const header = el.querySelector('.swimlane__header')
    const leftBound = header ? header.getBoundingClientRect().right : rect.left + EDGE_TOL

    let dir = 0
    let step = 0
    // NaN（未移動）時兩式皆 false → dir 維持 0。
    if (_edgeClientX <= leftBound) {
      // 左側：距離式緩衝。距 header 右緣越遠（越往畫面左緣）越快，二次方緩動。
      dir = -1
      _accelStart = 0 // 左側不用時間式，清掉右側殘留的計時，避免切換側時殘留加速
      const f = Math.min(1, (leftBound - _edgeClientX) / LEFT_RAMP_PX)
      step = MIN_STEP + (MAX_STEP - MIN_STEP) * f * f
    } else if (_edgeClientX >= rect.right - EDGE_TOL) {
      // 右側：時間式加速（游標頂著畫面右緣，靠停留時間計量）。
      dir = 1
      const now = performance.now()
      if (_accelStart === 0) _accelStart = now // 剛進入右側觸發區 → 從慢速重新起步
      const t = Math.min(1, (now - _accelStart) / ACCEL_MS)
      step = MIN_STEP + (MAX_STEP - MIN_STEP) * t * t
    } else {
      _accelStart = 0 // 離開觸發區 → 重置右側加速，下次重新從慢速起步
    }

    if (dir !== 0) {
      const before = el.scrollLeft
      el.scrollLeft += dir * step // 瀏覽器自動 clamp 到 [0, scrollWidth-clientWidth]
      const delta = el.scrollLeft - before
      if (delta !== 0) notifyAutoScroll()
    }
  }
  _rafId = requestAnimationFrame(autoScrollTick)
}

function startAutoScroll(): void {
  if (_rafId) return
  _edgeClientX = Number.NaN
  _accelStart = 0
  window.addEventListener('mousemove', onDragMouseMove)
  _rafId = requestAnimationFrame(autoScrollTick)
}

function stopAutoScroll(): void {
  if (_rafId) cancelAnimationFrame(_rafId)
  _rafId = 0
  window.removeEventListener('mousemove', onDragMouseMove)
}

watch(
  () => dragState.isDragging,
  (now) => {
    if (now) {
      startAutoScroll()
      _flipPrevX = restingIdToX() // 種下基準，讓首次落點變動就能從靜止位置滑出
    } else {
      stopAutoScroll()
      _flipPrevX = null
      setTimeout(clearFlipStyles, FLIP_MS + 40) // 等收尾動畫播完再清除殘留 inline 樣式
    }
  },
)

const marquee = ref<{ active: boolean; left: number; top: number; width: number; height: number }>({
  active: false, left: 0, top: 0, width: 0, height: 0,
})
let _mqStartX = 0
let _mqStartY = 0
let _mqAdditive = false
let _mqArmed = false
let _mqActive = false
let _justMarqueed = false

function onScrollMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return
  if (dragState.isDragging) return
  const t = event.target as Element | null
  if (!t) return
  // 框選起手區：主軸捲動容器空白處，或頂部標題列空白處。
  // 刻意不含側邊欄（避免與側邊欄拖曳/捲動互搶）。掛在 window bubble，於 target
  // 自身處理（SortableJS 起拖）之後才跑，故不會搶走區塊拖曳。
  if (!t.closest('.board__scroll, .app-header')) return
  // 按在區塊/互動元素上 → 讓位給 SortableJS（不搶事件）
  if (t.closest('.rotation-block, button, input, textarea, [role="combobox"], .char-selector__listbox')) {
    return
  }
  _mqStartX = event.clientX
  _mqStartY = event.clientY
  _mqAdditive = event.ctrlKey || event.metaKey
  _mqArmed = true
  _mqActive = false
  window.addEventListener('mousemove', onMarqueeMove)
  window.addEventListener('mouseup', onMarqueeUp)
}

function onMarqueeMove(event: MouseEvent): void {
  if (!_mqArmed) return
  const dx = event.clientX - _mqStartX
  const dy = event.clientY - _mqStartY
  if (!_mqActive && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
  _mqActive = true
  marquee.value = {
    active: true,
    left: Math.min(_mqStartX, event.clientX),
    top: Math.min(_mqStartY, event.clientY),
    width: Math.abs(dx),
    height: Math.abs(dy),
  }
}

function onMarqueeUp(): void {
  window.removeEventListener('mousemove', onMarqueeMove)
  window.removeEventListener('mouseup', onMarqueeUp)

  if (_mqActive) {
    const r = marquee.value
    const right = r.left + r.width
    const bottom = r.top + r.height
    const hit: string[] = []
    document.querySelectorAll<HTMLElement>('.rotation-block[data-entry-id]').forEach((el) => {
      const b = el.getBoundingClientRect()
      if (b.left < right && b.right > r.left && b.top < bottom && b.bottom > r.top) {
        const id = el.getAttribute('data-entry-id')
        if (id) hit.push(id)
      }
    })
    rotationStore.selectBlocks(hit, _mqAdditive)
    _justMarqueed = true
    // 防呆：terminal click 會在 mouseup 後同步派發、被 onGlobalClickCapture 消化；
    // 但若 click 始終沒派發（例如鬆手在瀏覽器視窗外），旗標需自行清除，
    // 以免殘留而誤吞下一次正常點擊。
    setTimeout(() => { _justMarqueed = false }, 0)
  }

  _mqArmed = false
  _mqActive = false
  marquee.value = { active: false, left: 0, top: 0, width: 0, height: 0 }
}

// 框選剛結束時，攔截緊接的 click（避免 App.vue root @click 清掉剛選取的區塊）。
// 必須掛在 window capture：放開點在 .rotation-board 外時（例如往上框選最頂泳道、
// 在 board 上緣外鬆手），terminal click 的事件路徑不經過 .rotation-board，
// 若只掛在 board 上會攔不到而讓 app-root @click 清掉選取。window capture 是
// 事件分派的最外層，無論 click 落在何處都能搶先攔下。
function onGlobalClickCapture(event: MouseEvent): void {
  if (_justMarqueed) {
    event.stopPropagation()
    _justMarqueed = false
  }
}

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
      rotationStore.addFreeformBlock(label, char.themeColor, slotIndex, char.id)
    })
  })
}

// ══════════════════════════════════════════════════════════════
// 泳道垂直拖曳（自製）
// 拖把手 → 來源泳道原位留空、浮起分身跟游標、即時插入提示線；放開時改
// laneOrder，由 <TransitionGroup> 把各列平滑滑到新位。全程不動 entries /
// slotIndex / 欄位對齊，故各泳道區塊資料零變動。
// 拖曳期間「其餘泳道」位置固定（不即時 reflow），故起始量一次幾何即可。
// ══════════════════════════════════════════════════════════════
const rotationBoardRef = ref<HTMLElement | null>(null)

interface LaneGeom { slotIndex: SlotIndex; top: number; height: number; mid: number }

const laneDrag = reactive({
  active: false,
  slotIndex: null as SlotIndex | null,
  cloneTop: 0, // 分身上緣（相對 board）
  cloneWidth: 0,
  cloneHeight: 0,
  cloneColor: '#888888',
  cloneName: '',
  cloneElement: '',
  lineTop: null as number | null, // 插入提示線 Y（相對 board）；null = 隱藏
  targetIndex: 0, // 來源在「其餘泳道」中的最終插入位置
})

let _laneBoardTop = 0
let _otherGeoms: LaneGeom[] = [] // 非來源泳道（顯示序），拖曳期間位置固定
let _sourceDisplayIndex = 0
let _pointerOffsetY = 0 // 抓取點到來源上緣的距離

function _readLaneGeoms(): LaneGeom[] {
  const boardEl = rotationBoardRef.value
  if (!boardEl) return []
  const boardRect = boardEl.getBoundingClientRect()
  _laneBoardTop = boardRect.top
  const out: LaneGeom[] = []
  laneOrder.value.forEach((si) => {
    const el = boardEl.querySelector<HTMLElement>(`.swimlane[data-slot-index="${si}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    const top = r.top - boardRect.top
    out.push({ slotIndex: si, top, height: r.height, mid: top + r.height / 2 })
  })
  return out
}

function onLaneDragStart(payload: { slotIndex: SlotIndex; event: MouseEvent }): void {
  const geoms = _readLaneGeoms()
  const source = geoms.find((g) => g.slotIndex === payload.slotIndex)
  if (!source) return
  _sourceDisplayIndex = laneOrder.value.indexOf(payload.slotIndex)
  _otherGeoms = geoms.filter((g) => g.slotIndex !== payload.slotIndex)
  _pointerOffsetY = payload.event.clientY - (_laneBoardTop + source.top)

  const char = characterStore.slots[payload.slotIndex].character
  laneDrag.active = true
  laneDrag.slotIndex = payload.slotIndex
  laneDrag.cloneWidth = rotationBoardRef.value?.clientWidth ?? 0
  laneDrag.cloneHeight = source.height
  laneDrag.cloneColor = getElementColor(char?.element ?? null)
  laneDrag.cloneName = char?.nameZh ?? `槽位 ${payload.slotIndex + 1}`
  laneDrag.cloneElement = char?.element ?? ''
  _updateLaneTarget(payload.event.clientY)

  window.addEventListener('mousemove', onLaneDragMove)
  window.addEventListener('mouseup', onLaneDragEnd)
}

function _updateLaneTarget(clientY: number): void {
  const relY = clientY - _laneBoardTop
  laneDrag.cloneTop = relY - _pointerOffsetY // 分身跟游標（扣抓取偏移）
  // 來源在「其餘泳道」中的插入位置＝中點在游標之上的其餘泳道數
  let idx = 0
  for (const g of _otherGeoms) {
    if (g.mid < relY) idx++
    else break
  }
  laneDrag.targetIndex = idx
  // 插入線 Y
  if (_otherGeoms.length === 0) {
    laneDrag.lineTop = null
  } else if (idx <= 0) {
    laneDrag.lineTop = _otherGeoms[0].top
  } else if (idx >= _otherGeoms.length) {
    const last = _otherGeoms[_otherGeoms.length - 1]
    laneDrag.lineTop = last.top + last.height
  } else {
    laneDrag.lineTop = _otherGeoms[idx].top
  }
}

function onLaneDragMove(event: MouseEvent): void {
  if (!laneDrag.active) return
  _updateLaneTarget(event.clientY)
}

function onLaneDragEnd(): void {
  window.removeEventListener('mousemove', onLaneDragMove)
  window.removeEventListener('mouseup', onLaneDragEnd)
  if (laneDrag.active) {
    // 來源在「其餘泳道」插到 targetIndex → 即最終顯示序索引
    setOrderByMove(_sourceDisplayIndex, laneDrag.targetIndex)
  }
  laneDrag.active = false
  laneDrag.slotIndex = null
  laneDrag.lineTop = null
}

function handleResize(): void {
  void remeasureAfterRender()
}

onMounted(async () => {
  if (import.meta.env.DEV) {
    const slots = characterStore.slots
    if (!slots[0].character) characterStore.setCharacter(0, 'jiyan')
    if (!slots[1].character) characterStore.setCharacter(1, 'verina')
    if (!slots[2].character) characterStore.setCharacter(2, 'shorekeeper')
    seedStoreWithStubData()
  }

  await remeasureAfterRender()
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => void remeasureAfterRender())
  }
  window.addEventListener('resize', handleResize)

  // 框選起手：掛 window bubble（起點區由處理器內 closest 限定為主軸/標題列空白）。
  // bubble 階段在 target 自身處理之後才跑，不搶 SortableJS 的區塊起拖。
  window.addEventListener('mousedown', onScrollMouseDown)
  // 框選後的 terminal click 攔截：window capture 確保放開點在 board 外也攔得到
  window.addEventListener('click', onGlobalClickCapture, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('mousedown', onScrollMouseDown)
  window.removeEventListener('click', onGlobalClickCapture, true)
  stopAutoScroll()
  window.removeEventListener('mousemove', onMarqueeMove)
  window.removeEventListener('mouseup', onMarqueeUp)
  window.removeEventListener('mousemove', onLaneDragMove)
  window.removeEventListener('mouseup', onLaneDragEnd)
})
</script>

<template>
  <section
    ref="rotationBoardRef"
    class="rotation-board"
    :class="{ 'rotation-board--lane-dragging': laneDrag.active }"
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

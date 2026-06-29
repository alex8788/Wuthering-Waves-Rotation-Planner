<script setup lang="ts">
// Swimlane.vue：單一角色的橫向時間軸軌道

// 核心機制：
// 1. 使用 VueDraggable 處理區塊拖曳。
// 2. 綁定 localEntries 緩衝陣列，避免套件直接修改唯讀 props 導致 VDOM 脫鉤。
// 3. 拖曳結束後由 useBlockDrag 換算全域索引並更新 store，watch 再同步回 localEntries。

import { ref, computed, watch, nextTick } from 'vue'
import { useDraggable } from 'vue-draggable-plus'
import RotationBlock from '@/components/rotation/RotationBlock.vue'
import CharacterSelector from '@/components/character/CharacterSelector.vue'
import { useRotationStore } from '@/stores/useRotationStore'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useBlockDrag, DROP_ZONE_ATTRIBUTE, type SortableEventLike } from '@/composables/useBlockDrag'
import { getElementColor } from '@/constants/elements'
import type { Character } from '@/types/character'
import type { RotationEntry } from '@/types/rotation'

// ── Props ────────────────────────────────────────────────────

interface Props {
  /** 此泳道對應的角色 (null 代表未選角) */
  character: Character | null
  /** 槽位索引 (0 / 1 / 2) */
  slotIndex: 0 | 1 | 2
  /** 父層過濾後的區塊序列 (唯讀真相來源) */
  entries: RotationEntry[]
  /** 三條泳道共用的 grid-template-columns（拖曳時為含落點空欄的預覽版） */
  gridTemplate: string
  /** entryId → 全域 0-based 欄位序，供 grid-column 定位（拖曳時為預覽版） */
  idToColumnIndex: Map<string, number>
  /** 落點空欄的 0-based 欄序（拖曳預覽用，null = 無落點） */
  placeholderColumn: number | null
  /** 落點所在泳道（只有此泳道畫單欄虛框） */
  previewSlotIndex: 0 | 1 | 2 | null
  /** 泳道拖曳中且本泳道為來源 → 原位顯示為留空佔位 */
  draggingAsSource?: boolean
}

const props = defineProps<Props>()

// 泳道拖曳：把手按下時通知父層（RotationBoard）啟動自製垂直 reorder。
// 帶上原生 MouseEvent 供父層取得起始游標座標。
const emit = defineEmits<{
  (e: 'lane-drag-start', payload: { slotIndex: 0 | 1 | 2; event: MouseEvent }): void
}>()

function handleLaneDragStart(event: MouseEvent): void {
  // 阻止冒泡到 window：避免觸發 RotationBoard 的框選 marquee；並停掉文字選取。
  event.stopPropagation()
  event.preventDefault()
  emit('lane-drag-start', { slotIndex: props.slotIndex, event })
}

// ── Store / Composable ──────────────────────────────────────

const rotationStore = useRotationStore()
const characterStore = useCharacterStore()
const {
  dragState,
  onRotationDragStart,
  handleSidebarToLaneDrop,
  handleSameLaneDrop,
  handleDragEnd,
  getRotationSortableOptions,
} = useBlockDrag()

// 本泳道統一顏色＝角色屬性色（同屬性 header 色條/區塊顏色完全一致）。未選角給中性色。
const laneColor = computed<string>(() => getElementColor(props.character?.element ?? null))

// VueDraggable 操作的本地緩衝陣列，防止套件直接修改 prop 導致資料流脫鉤
const localEntries = ref<RotationEntry[]>([...props.entries])

// 當 store 更新導致 props.entries 改變時，同步校正緩衝陣列
watch(
  () => props.entries,
  (newEntries) => {
    localEntries.value = [...newEntries]
  }
)

// 可拖曳容器 DOM 參照：useDraggable 把 SortableJS 掛在這個元素上（取代 <VueDraggable>）。
const trackEl = ref<HTMLElement | null>(null)

// SortableJS 設定 + 事件處理器。
// 關鍵：刻意「不把 localEntries 當受管清單傳給 useDraggable」（用兩參數 el+options 形式）。
// 本 app 自有單一真相流：handleDragEnd → store → watch(props.entries) → localEntries → Vue 重渲染，
// SortableJS 僅負責「偵測拖曳 + 浮動分身視覺」。若把清單交給 useDraggable 受管，套件會在
// 「原地放開」(SortableJS 眼中 oldIndex===newIndex) 時跑內部 replaceChild 還原 DOM，擾動容器
// 子節點，導致尾端非 keyed 的 ＋按鈕 v-show 與 Vue vdom 脫鉤（放開後按鈕卡 display:none）。
// 不傳清單 → 套件不安裝內部清單變動/還原處理器 → 不碰 DOM → Vue 維持唯一 DOM 真相。
const dragOptions = computed(
  (): Record<string, unknown> => ({
    ...getRotationSortableOptions(props.slotIndex),
    // 容器只在「已選角」時渲染（v-else 內），trackEl 初始為 null；關閉自動初始化，
    // 改由下方 watch 在容器出現時手動 start，避免 SortableJS 收到 null 於 mounted 拋例外。
    immediate: false,
    onStart: handleDragStart,
    onAdd: handleAdd,
    onUpdate: handleUpdate,
    onEnd: handleEnd,
  })
)

// 兩參數形式：只掛拖曳行為，不交出清單管理權（見上方註解）。
const { start: startDraggable, destroy: destroyDraggable } = useDraggable(trackEl, dragOptions)

// 容器隨「選角/清空」動態出現或消失：出現時掛上拖曳、消失時銷毀，避免持有脫離 DOM 的實例。
watch(trackEl, (el) => {
  if (el) startDraggable(el)
  else destroyDraggable()
})

// 每個區塊的定位樣式：
//  - 被拖本體：隱藏並抽離 grid flow（forceFallback 分身在跟手；落點由預覽空欄表示）。
//  - 其餘：依（預覽版）欄序釘 grid-column；拿不到欄序則隱藏（保險）。
function blockStyle(id: string): Record<string, string> {
  // 被拖區塊（多選＝整組）一律隱藏並抽離 grid flow；落點由共用預覽空欄表示。
  if (dragState.isDragging && (id === dragState.draggingId || dragState.draggingIds.includes(id))) {
    return { visibility: 'hidden', position: 'absolute', pointerEvents: 'none' }
  }
  const col = props.idToColumnIndex.get(id)
  return col != null ? { gridColumn: String(col + 1) } : { display: 'none' }
}

// 反查被拖區塊對應的 entry。優先用被拖 DOM 的 data-entry-id 直接比對（最穩；
// 不受 grid 內裝飾節點＋按鈕/落點虛框影響 SortableJS 索引而對不到 → 抓不起來）。
// 退而求其次才用事件索引。
function getEntryFromDragEvent(event: SortableEventLike): RotationEntry | undefined {
  const id = event.item?.getAttribute?.('data-entry-id')
  if (id) {
    const byId = localEntries.value.find((e) => e.id === id)
    if (byId) return byId
  }
  const localIndex = event.oldDraggableIndex ?? event.oldIndex ?? -1
  return localEntries.value[localIndex]
}

// ── 事件處理 ──────────────────────────────────────────────────

// 拖曳起點：記錄本泳道既有區塊的起點，並量被拖 DOM 寬度作為落點空欄寬
function handleDragStart(event: SortableEventLike): void {
  const entry = getEntryFromDragEvent(event)
  if (!entry) return
  const width = event.item?.getBoundingClientRect().width ?? 0
  onRotationDragStart(entry, width)
}

// 側邊欄拖入本泳道 (onAdd)
// SortableJS 在跨清單複製（pull:'clone' + forceFallback）時，會把一個克隆的
// DOM 節點實際插入到本泳道清單裡。這個節點是側邊欄 chip 的克隆，結構與本泳道
// 的 RotationBlock 不同；若放任它留下，Vue 會以相同 :key 嘗試接管這個外來節點，
// 造成 VDOM 與 SortableJS 內部參照雙重脫鉤（下一次拖曳即失效）。
// 依 SortableJS 官方建議：「自行管理資料時，於 onAdd 移除套件插入的節點」，
// 改由 store 更新 → watch → Vue 重新渲染作為唯一的 DOM 來源。
function handleAdd(event: SortableEventLike): void {
  handleSidebarToLaneDrop(event, props.slotIndex)
}

// 本泳道內重新排序 (onUpdate)
function handleUpdate(event: SortableEventLike): void {
  handleSameLaneDrop(event, props.slotIndex)
}

// 拖曳結束
function handleEnd(event: SortableEventLike): void {
  handleDragEnd(event)
}

// 區塊點擊選取 (支援 Ctrl/Meta 多選)
function handleBlockSelect(entryId: string, event: MouseEvent): void {
  const isMultiSelect = event.ctrlKey || event.metaKey
  rotationStore.selectBlock(entryId, isMultiSelect)
}

// 註：拖曳到可刪除區的紅色警告，改由 useBlockDrag 在 <body> 掛全域 class、
// 純 CSS 直接套在 SortableJS 浮動克隆 .sortable-fallback 上（forceFallback 下
// 響應式 prop 無法作用於靜態克隆），故此處不再逐塊計算 danger 狀態。

// ── 既有邏輯 ──────────────────────────────────────────────────

// ＋ 按鈕在共用 grid 內的 0-based 欄序：該泳道自己最後一個區塊的欄序 + 1
// （落在其後一欄，而非整條 grid 末端）。空泳道 → 第 0 欄（靠左）。
// 用（非預覽版）欄序即可，因拖曳預覽期間 ＋ 會隱藏。
const addButtonColumn = computed<number>(() => {
  let lastCol = -1
  for (const entry of localEntries.value) {
    const col = props.idToColumnIndex.get(entry.id)
    if (col != null && col > lastCol) lastCol = col
  }
  return lastCol + 1
})

// 定位本泳道最後一個區塊的全局索引；若為空則回傳全局末尾
const insertAfterIndex = computed<number>(() => {
  const globalEntries = rotationStore.entries
  for (let i = globalEntries.length - 1; i >= 0; i--) {
    if (globalEntries[i].slotIndex === props.slotIndex) {
      return i
    }
  }
  return globalEntries.length - 1
})

// 行內編輯狀態集中於 rotationStore（editingId/editingDraft），讓 RotationBoard
// 的量測列能即時讀到草稿、據以即時重算欄寬。本泳道只負責觸發與轉發。

// 於本泳道末尾新增空白實體區塊，並立即進入行內編輯讓使用者輸入 label
function handleAddBlock(): void {
  if (!props.character) return
  const newId = rotationStore.addFreeformBlock(
    '',
    laneColor.value,
    props.slotIndex,
    props.character.id,
    insertAfterIndex.value,
  )
  // 等 watch 把新區塊渲染進 localEntries 後再標記編輯（RotationBlock 會自動聚焦）
  void nextTick(() => {
    rotationStore.startEditing(newId)
  })
}

// 雙擊區塊 → 進入編輯
function handleRequestEdit(entryId: string): void {
  rotationStore.startEditing(entryId)
}

// 提交：寫入 store（空字串由 store.updateLabel 處理為刪除），結束編輯
function handleCommitLabel(entryId: string, label: string): void {
  rotationStore.updateLabel(entryId, label)
  if (rotationStore.editingId === entryId) rotationStore.stopEditing()
}

// 取消：不動 store，結束編輯。若是剛新增的空白區塊（label 仍為空），順手刪除避免殘留空塊。
function handleCancelEdit(entryId: string): void {
  const entry = rotationStore.entries.find((e) => e.id === entryId)
  if (entry && entry.block.label.trim() === '') {
    rotationStore.deleteBlock(entryId)
  }
  if (rotationStore.editingId === entryId) rotationStore.stopEditing()
}

// 點擊軌道空白處時清除全域選取
function handleTrackClick(): void {
  rotationStore.clearSelection()
}

// header 選擇器變更角色 → 先清空本泳道既有區塊（換角色＝重開連招），再寫入 characterStore
function handleSelectCharacter(characterId: string): void {
  if (props.character?.id !== characterId) {
    rotationStore.clearSlot(props.slotIndex)
  }
  characterStore.setCharacter(props.slotIndex, characterId)
}
</script>

<template>
  <div
    class="swimlane"
    :class="[`swimlane--slot-${slotIndex}`, { 'swimlane--drag-source': draggingAsSource }]"
    :[DROP_ZONE_ATTRIBUTE]="true"
    :data-slot-index="slotIndex"
    :aria-label="character ? `${character.nameZh} 的輸出軸` : `槽位 ${slotIndex + 1}（未選角）`"
  >

    <div
      class="swimlane__header"
      :style="{ '--lane-color': laneColor }"
      aria-hidden="false"
    >
      <div
        class="header__color-bar"
        :style="{ backgroundColor: character ? laneColor : 'rgba(255,255,255,0.15)' }"
        aria-hidden="true"
      />

      <!-- 泳道拖曳把手：header 內最左欄、垂直置中；右側內容欄整體右推（略縮寬）。 -->
      <button
        class="header__drag-handle"
        type="button"
        aria-label="拖曳調整泳道順序"
        title="拖曳調整泳道順序"
        @mousedown="handleLaneDragStart"
      >
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
          <circle cx="2.5" cy="3" r="1.1" fill="currentColor" />
          <circle cx="7.5" cy="3" r="1.1" fill="currentColor" />
          <circle cx="2.5" cy="8" r="1.1" fill="currentColor" />
          <circle cx="7.5" cy="8" r="1.1" fill="currentColor" />
          <circle cx="2.5" cy="13" r="1.1" fill="currentColor" />
          <circle cx="7.5" cy="13" r="1.1" fill="currentColor" />
        </svg>
      </button>

      <div class="header__content">
        <div class="header__selector">
          <CharacterSelector
            :model-value="character?.id ?? null"
            :options="characterStore.allCharacters"
            placeholder="選擇角色"
            @update:model-value="handleSelectCharacter"
          />
        </div>

        <span
          v-if="character"
          class="header__element"
          :style="{ color: laneColor }"
          :aria-label="`屬性：${character.element}`"
        >
          {{ character.element }}
        </span>
      </div>
    </div>

    <div
      class="swimlane__track"
      role="list"
      :aria-label="character ? `${character.nameZh} 的區塊序列` : '區塊序列'"
      @click="handleTrackClick"
    >
      <div class="track__inner">

        <div v-if="!character" class="track__empty-hint" aria-label="請先於上方選擇角色">
          請先選擇角色
        </div>

        <template v-else>
          <div
            ref="trackEl"
            class="track__draggable"
            :class="{ 'track__draggable--empty': localEntries.length === 0 }"
            :style="{ gridTemplateColumns: gridTemplate }"
          >
            <RotationBlock
              v-for="entry in localEntries"
              :key="entry.id"
              :entry-id="entry.id"
              :label="entry.block.label"
              :color="laneColor"
              :is-selected="rotationStore.isSelected(entry.id)"
              :is-editing="rotationStore.editingId === entry.id"
              :is-leaving="rotationStore.isLeaving(entry.id)"
              :style="blockStyle(entry.id)"
              role="listitem"
              @select="(event) => handleBlockSelect(entry.id, event)"
              @request-edit="handleRequestEdit(entry.id)"
              @draft-change="(text: string) => rotationStore.setEditingDraft(text)"
              @commit="(label) => handleCommitLabel(entry.id, label)"
              @cancel="handleCancelEdit(entry.id)"
            />

            <!-- 落點空欄虛框：只有落點泳道畫；其他兩泳道因共用 template 也會同步空出該欄 -->
            <div
              v-if="previewSlotIndex === slotIndex && placeholderColumn != null"
              class="track__preview-slot"
              :style="{ gridColumn: String(placeholderColumn + 1) }"
              aria-hidden="true"
            />

            <!-- ＋ 按鈕：定位在該泳道自己最後一個區塊之後（共用 grid 內以 grid-column 釘位）。
                 被 SortableJS draggable:'.rotation-block' 選擇器排除，不會被當成可拖項。
                 拖曳預覽期間隱藏，避免與落點空欄搶欄、或造成 grid 欄數變動。 -->
            <button
              v-show="!dragState.isDragging"
              class="track__add-btn"
              :style="{ gridColumn: String(addButtonColumn + 1) }"
              type="button"
              :aria-label="`在 ${character.nameZh} 的輸出軸新增區塊`"
              :title="`新增區塊至 ${character.nameZh}`"
              @click.stop="handleAddBlock"
            >
              ＋
            </button>
          </div>

          <div
            v-if="localEntries.length === 0 && idToColumnIndex.size === 0 && dragState.isDragging && dragState.sourceType !== 'rotation-instance'"
            class="track__empty-dropzone"
            aria-hidden="true"
          >
            拖放至此
          </div>
        </template>

      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── CSS 自訂屬性 ────────────────────────────────────────── */
.swimlane {
  --header-width: 8.5rem;
  --lane-height: 4rem;
  --lane-color: rgba(255, 255, 255, 0.18);
  --track-gap: 0.375rem;
  --track-px: 0.75rem;

  display: flex;
  align-items: stretch;
  height: var(--lane-height);
  /* 共用水平捲動：泳道由內容撐寬（max-content），但至少填滿捲動視窗（min-width:100%），
     讓三泳道等寬且對齊；橫向捲軸統一由上層 .board__scroll 提供。 */
  width: max-content;
  min-width: 100%;

  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.swimlane:last-child {
  border-bottom: none;
}

.swimlane--slot-0 { background: rgba(255, 255, 255, 0.020); }
.swimlane--slot-1 { background: rgba(255, 255, 255, 0.013); }
.swimlane--slot-2 { background: rgba(255, 255, 255, 0.006); }

/* ══════════════════════════════════════════════════════════
   左側 Header
   ══════════════════════════════════════════════════════════ */
.swimlane__header {
  /* sticky 固定在左側：橫向捲動時角色名不跟著捲走。
     必須用不透明底色，否則捲動時區塊會從 header 下方透出。 */
  position: sticky;
  left: 0;
  flex-shrink: 0;
  width: var(--header-width);

  /* 橫向：左欄為拖曳把手（垂直置中），右欄為內容（選單＋屬性，垂直堆疊）。 */
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.5rem;

  border-right: 1px solid rgba(255, 255, 255, 0.07);

  z-index: 5;
  /* 不透明底（面板深色），上面再疊各槽位細微色調 */
  background-color: #0b101d;
}

/* 右側內容欄：選單（上）＋屬性（下）垂直堆疊；佔滿把手以外的剩餘寬度。 */
.header__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.125rem;
}

.header__color-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  transition: background-color 0.25s ease;
}

.header__selector {
  width: 100%;
}

/* 泳道 header 空間有限，將共用的 CharacterSelector 觸發鈕壓成精簡尺寸 */
.header__selector :deep(.char-selector__trigger) {
  height: 1.75rem;
  padding: 0 0.5rem;
  gap: 0.4rem;
  background-color: rgba(255, 255, 255, 0.04);
  border-radius: 4px;
}

.header__selector :deep(.char-selector__value) {
  font-size: 0.75rem;
  font-weight: 500;
}

.header__element {
  font-size: 0.5625rem;
  font-weight: 400;
  letter-spacing: 0.08em;
  opacity: 0.65;
  user-select: none;
  line-height: 1;
}

/* 泳道拖曳把手：header 最左欄、垂直置中（靠左緣對齊） */
.header__drag-handle {
  flex-shrink: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 0.875rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.28);
  cursor: grab;
  transition: color 0.15s ease;
}
.header__drag-handle:hover {
  color: rgba(34, 211, 238, 0.85);
}
.header__drag-handle:active {
  cursor: grabbing;
}
.header__drag-handle:focus {
  outline: none;
}
.header__drag-handle:focus-visible {
  color: rgba(34, 211, 238, 0.85);
}

/* 泳道拖曳中：來源泳道原位留空（內容隱藏、保留高度、虛線佔位框） */
.swimlane--drag-source {
  background: rgba(125, 211, 252, 0.04);
  outline: 1.5px dashed rgba(125, 211, 252, 0.35);
  outline-offset: -4px;
}
.swimlane--drag-source > * {
  visibility: hidden;
}

/* ══════════════════════════════════════════════════════════
   右側 Track（可橫向捲動）
   ══════════════════════════════════════════════════════════ */
.swimlane__track {
  flex: 1;
  min-width: 0;
  /* 不再各自捲動：橫向捲軸統一由上層 .board__scroll 提供，確保三泳道捲動同步、對齊不破 */
  overflow: visible;
}

.track__inner {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--track-gap);
  height: 100%;
  padding: 0 var(--track-px);
  width: max-content;
  min-width: 100%;
}

/* 單線程欄位對齊：以 grid 取代 flex，gridTemplateColumns 由父層注入（三泳道共用）。
   真實區塊用 grid-column 放到全域欄位，未佔用的欄自然留白 → 縱向對齊。 */
.track__draggable {
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: var(--track-gap);
  width: max-content;
}

/* 泳道本身為空時撐滿，讓 SortableJS 在任意位置都能命中此清單。
   但若全域序列非空（gridTemplate 有值），仍需保留 grid 欄位以維持對齊，
   故 flex 撐滿只在「全域也為空」時才套用（此時 gridTemplate 為空字串）。 */
.track__draggable--empty:not([style*='grid-template-columns:']) {
  display: flex;
  flex: 1;
  align-self: stretch;
}

/* 落點空欄虛框（拖曳預覽）：佔據共用 grid 的落點欄，呈現「將插入於此」的提示。
   高度貼齊區塊；不攔截滑鼠事件（hit-test 用 elementFromPoint 需穿透）。 */
.track__preview-slot {
  align-self: center;
  height: 3rem;
  border: 1.5px dashed rgba(125, 211, 252, 0.7);
  border-radius: 3px;
  background: rgba(125, 211, 252, 0.10);
  pointer-events: none;
}

.track__empty-dropzone {
  position: absolute;
  top: 0.25rem;
  bottom: 0.25rem;
  left: var(--track-px);
  right: var(--track-px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(125, 211, 252, 0.45);
  border-radius: 6px;
  background: rgba(125, 211, 252, 0.06);
  color: rgba(125, 211, 252, 0.65);
  font-size: 0.6875rem;
  letter-spacing: 0.05em;
  user-select: none;
  pointer-events: none;
}

/* ＋ 按鈕現位於共用 grid 內，用 grid-column 釘在該泳道最後一個區塊之後。
   align-self/justify-self 控制其在欄內的對齊；空泳道（flex fallback）時自然靠左。 */
.track__add-btn {
  align-self: center;
  justify-self: start;
  display: flex;
  align-items: center;
  justify-content: center;

  width: 1.5rem;
  height: 1.5rem;
  border-radius: 4px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  background: transparent;
  color: rgba(255, 255, 255, 0.28);

  font-size: 0.875rem;
  line-height: 1;
  cursor: pointer;

  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease;
}

.track__add-btn:hover,
.track__add-btn:focus-visible {
  border-color: rgba(255, 255, 255, 0.45);
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.06);
}

/* 移除瀏覽器預設 focus ring（橘/白外框，非本專案實作）；
   改用與 hover 一致的回饋（focus-visible）保留鍵盤可視性。 */
.track__add-btn:focus {
  outline: none;
}

.track__add-btn:active {
  background: rgba(255, 255, 255, 0.10);
  transform: scale(0.93);
}

.track__empty-hint {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.18);
  letter-spacing: 0.05em;
  user-select: none;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .header__color-bar,
  .header__dot {
    transition: none;
  }
}
</style>
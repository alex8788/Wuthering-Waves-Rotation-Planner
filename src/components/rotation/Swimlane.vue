<script setup lang="ts">
// Swimlane.vue：單一角色的橫向時間軸軌道

// 核心機制：
// 1. 使用 VueDraggable 處理區塊拖曳。
// 2. 綁定 localEntries 緩衝陣列，避免套件直接修改唯讀 props 導致 VDOM 脫鉤。
// 3. 拖曳結束後由 useBlockDrag 換算全域索引並更新 store，watch 再同步回 localEntries。

import { ref, computed, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import RotationBlock from '@/components/rotation/RotationBlock.vue'
import { useRotationStore } from '@/stores/useRotationStore'
import { useBlockDrag, DROP_ZONE_ATTRIBUTE, type SortableEventLike } from '@/composables/useBlockDrag'
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
}

const props = defineProps<Props>()

// ── Store / Composable ──────────────────────────────────────

const rotationStore = useRotationStore()
const {
  dragState,
  onRotationDragStart,
  handleSidebarToLaneDrop,
  handleSameLaneDrop,
  handleDragEnd,
  getRotationSortableOptions,
} = useBlockDrag()

// VueDraggable 操作的本地緩衝陣列，防止套件直接修改 prop 導致資料流脫鉤
const localEntries = ref<RotationEntry[]>([...props.entries])

// 當 store 更新導致 props.entries 改變時，同步校正緩衝陣列
watch(
  () => props.entries,
  (newEntries) => {
    localEntries.value = [...newEntries]
  }
)

// 取得本泳道專屬的 SortableJS 設定 (包含 group 角色匹配防護等)
const dragOptions = computed(
  (): Record<string, unknown> => getRotationSortableOptions(props.slotIndex)
)

// 每個區塊的定位樣式：
//  - 被拖本體：隱藏並抽離 grid flow（forceFallback 分身在跟手；落點由預覽空欄表示）。
//  - 其餘：依（預覽版）欄序釘 grid-column；拿不到欄序則隱藏（保險）。
function blockStyle(id: string): Record<string, string> {
  if (dragState.isDragging && id === dragState.draggingId) {
    return { visibility: 'hidden', position: 'absolute', pointerEvents: 'none' }
  }
  const col = props.idToColumnIndex.get(id)
  return col != null ? { gridColumn: String(col + 1) } : { display: 'none' }
}

// 依 SortableJS 事件索引反查對應區塊 (僅限同泳道拖曳起點 @start 且未發生 splice 時使用)
function getEntryFromDragEvent(event: SortableEventLike): RotationEntry | undefined {
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

// 於本泳道末尾新增空白實體區塊
function handleAddBlock(): void {
  if (!props.character) return
  rotationStore.addFreeformBlock(
    '',
    props.character.themeColor,
    props.slotIndex,
    props.character.id,
    insertAfterIndex.value,
  )
}

// 點擊軌道空白處時清除全域選取
function handleTrackClick(): void {
  rotationStore.clearSelection()
}
</script>

<template>
  <div
    class="swimlane"
    :class="`swimlane--slot-${slotIndex}`"
    :[DROP_ZONE_ATTRIBUTE]="true"
    :data-slot-index="slotIndex"
    :aria-label="character ? `${character.nameZh} 的輸出軸` : `槽位 ${slotIndex + 1}（未選角）`"
  >

    <div
      class="swimlane__header"
      :style="character ? { '--lane-color': character.themeColor } : {}"
      aria-hidden="false"
    >
      <div
        class="header__color-bar"
        :style="{ backgroundColor: character?.themeColor ?? 'rgba(255,255,255,0.15)' }"
        aria-hidden="true"
      />

      <div class="header__info">
        <span
          class="header__dot"
          :style="{ backgroundColor: character?.themeColor ?? 'rgba(255,255,255,0.25)' }"
          aria-hidden="true"
        />
        <span
          class="header__name"
          :class="{ 'header__name--empty': !character }"
        >
          {{ character?.nameZh ?? '未選角' }}
        </span>
      </div>

      <span
        v-if="character"
        class="header__element"
        :style="{ color: character.themeColor }"
        aria-label="`屬性：${character.element}`"
      >
        {{ character.element }}
      </span>
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
          <VueDraggable
            v-model="localEntries"
            item-key="id"
            tag="div"
            class="track__draggable"
            :class="{ 'track__draggable--empty': localEntries.length === 0 }"
            :style="{ gridTemplateColumns: gridTemplate }"
            v-bind="dragOptions"
            @start="handleDragStart"
            @add="handleAdd"
            @update="handleUpdate"
            @end="handleEnd"
          >
            <RotationBlock
              v-for="entry in localEntries"
              :key="entry.id"
              :entry-id="entry.id"
              :label="entry.block.label"
              :color="entry.block.color || character.themeColor"
              :is-selected="rotationStore.isSelected(entry.id)"
              :style="blockStyle(entry.id)"
              role="listitem"
              @select="(event) => handleBlockSelect(entry.id, event)"
            />

            <!-- 落點空欄虛框：只有落點泳道畫；其他兩泳道因共用 template 也會同步空出該欄 -->
            <div
              v-if="previewSlotIndex === slotIndex && placeholderColumn != null"
              class="track__preview-slot"
              :style="{ gridColumn: String(placeholderColumn + 1) }"
              aria-hidden="true"
            />
          </VueDraggable>

          <div
            v-if="localEntries.length === 0 && idToColumnIndex.size === 0 && dragState.isDragging && dragState.sourceType !== 'rotation-instance'"
            class="track__empty-dropzone"
            aria-hidden="true"
          >
            拖放至此
          </div>

          <div
            class="track__tail"
            :class="{ 'track__tail--lane-empty': localEntries.length === 0 }"
          >
            <button
              class="track__add-btn"
              type="button"
              :aria-label="`在 ${character.nameZh} 的輸出軸末尾新增區塊`"
              :title="`新增區塊至 ${character.nameZh}`"
              @click.stop="handleAddBlock"
            >
              ＋
            </button>
          </div>
        </template>

      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── CSS 自訂屬性 ────────────────────────────────────────── */
.swimlane {
  --header-width: 6rem;
  --lane-height: 3.5rem;
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

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.125rem;
  padding: 0 0.625rem;

  border-right: 1px solid rgba(255, 255, 255, 0.07);

  z-index: 5;
  /* 不透明底（面板深色），上面再疊各槽位細微色調 */
  background-color: #0b101d;
}

.header__color-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  transition: background-color 0.25s ease;
}

.header__info {
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  width: 100%;
  overflow: hidden;
}

.header__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background-color 0.25s ease;
}

.header__name {
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.82);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.02em;
  line-height: 1;
}

.header__name--empty {
  color: rgba(255, 255, 255, 0.25);
  font-weight: 400;
  font-style: italic;
}

.header__element {
  font-size: 0.5625rem;
  font-weight: 400;
  letter-spacing: 0.08em;
  opacity: 0.65;
  user-select: none;
  line-height: 1;
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
  height: 2.5rem;
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

.track__tail {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-left: 0.25rem;
  padding-right: var(--track-px);
}

/* 空泳道時，draggable 命中區以 flex:1 撐滿整條泳道（不可改動），會把 ＋ 按鈕
   擠到最右邊；用 order 讓 ＋ 按鈕排到最前（靠左），命中區範圍維持不變。 */
.track__tail--lane-empty {
  order: -1;
  padding-left: 0;
}

.track__add-btn {
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

.track__add-btn:hover {
  border-color: rgba(255, 255, 255, 0.45);
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.06);
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
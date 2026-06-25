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

// 依 SortableJS 事件索引反查對應區塊 (僅限同泳道拖曳起點 @start 且未發生 splice 時使用)
function getEntryFromDragEvent(event: SortableEventLike): RotationEntry | undefined {
  const localIndex = event.oldDraggableIndex ?? event.oldIndex ?? -1
  return localEntries.value[localIndex]
}

// ── 事件處理 ──────────────────────────────────────────────────

// 拖曳起點：僅記錄本泳道既有區塊的起點 (側邊欄拖入由 sidebar 處理)
function handleDragStart(event: SortableEventLike): void {
  const entry = getEntryFromDragEvent(event)
  if (entry) onRotationDragStart(entry)
}

// 側邊欄拖入本泳道 (onAdd)
// 拖曳預覽用的暫時物件與正式寫入 store 的資料共用同一個 id（見
// useBlockDrag.ts 的 pendingInstanceId），:key 全程不變，可以同步寫入，
// 不需要延後時機。
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

// 判斷區塊是否應顯示「拖曳刪除」紅色警告 (正被拖曳且懸停於無效放置區)
function isEntryDanger(entryId: string): boolean {
  return dragState.draggingId === entryId && dragState.isOverInvalidZone
}

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
              :is-danger="isEntryDanger(entry.id)"
              role="listitem"
              @select="(event) => handleBlockSelect(entry.id, event)"
            />
          </VueDraggable>

          <div
            v-if="localEntries.length === 0 && dragState.isDragging && dragState.sourceType !== 'rotation-instance'"
            class="track__empty-dropzone"
            aria-hidden="true"
          >
            拖放至此
          </div>

          <div class="track__tail">
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
  width: 100%;

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
  position: relative;
  flex-shrink: 0;
  width: var(--header-width);

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.125rem;
  padding: 0 0.625rem;

  border-right: 1px solid rgba(255, 255, 255, 0.07);

  z-index: 1;
  background: inherit;
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
  overflow-x: auto;
  overflow-y: hidden;

  scrollbar-width: none;
}

.swimlane__track::-webkit-scrollbar {
  display: none;
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

.track__draggable {
  display: flex;
  align-items: center;
  gap: var(--track-gap);
  min-width: 0;
}

/* 泳道為空時，撐滿整條泳道寬度，讓 SortableJS 在任意位置都能命中此清單 */
.track__draggable--empty {
  flex: 1;
  align-self: stretch;
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
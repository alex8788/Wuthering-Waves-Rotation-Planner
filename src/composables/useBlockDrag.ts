import { reactive, readonly } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useSidebarStore } from '@/stores/useSidebarStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { getEntriesBySlot } from '@/utils/arrayHelpers';
import type { DefaultBlock, TemplateBlock } from '@/types/block';
import type { RotationEntry, DragSourceType } from '@/types/rotation';
import type { SlotIndex } from '@/types/character';

// 合法放置容器需掛上此屬性，供 _handleDragOver 判斷游標是否在無效區
export const DROP_ZONE_ATTRIBUTE = 'data-drop-zone';

export interface SortableEventLike {
  oldIndex?: number;
  newIndex?: number;
  oldDraggableIndex?: number;
  newDraggableIndex?: number;
  to?: HTMLElement;   // 放置目標容器
  from?: HTMLElement; // 拖曳來源容器
}

interface DragState {
  isDragging: boolean;
  sourceType: DragSourceType | null;
  draggingId: string | null;
  draggingSourceBlock: DefaultBlock | TemplateBlock | null;
  draggingSlotIndex: SlotIndex | null;
  isOverSidebar: boolean;
  isOverInvalidZone: boolean;
  dropHandled: boolean;
}

const _dragState = reactive<DragState>({
  isDragging: false,
  sourceType: null,
  draggingId: null,
  draggingSourceBlock: null,
  draggingSlotIndex: null,
  isOverSidebar: false,
  isOverInvalidZone: false,
  dropHandled: false,
});

// 原生 DnD 模式（forceFallback: false）下用 dragover 偵測游標是否在合法容器外
function _handleDragOver(event: DragEvent): void {
  if (!_dragState.isDragging) return;
  const isOverValidZone = !!(event.target as HTMLElement)?.closest(`[${DROP_ZONE_ATTRIBUTE}]`);
  _dragState.isOverInvalidZone = !isOverValidZone;
}

let _isDragOverListenerAttached = false;

function _attachDragOverListener(): void {
  if (_isDragOverListenerAttached) return;
  window.addEventListener('dragover', _handleDragOver);
  _isDragOverListenerAttached = true;
}

function _detachDragOverListener(): void {
  if (!_isDragOverListenerAttached) return;
  window.removeEventListener('dragover', _handleDragOver);
  _isDragOverListenerAttached = false;
}

function _resetDragState(): void {
  _dragState.isDragging = false;
  _dragState.sourceType = null;
  _dragState.draggingId = null;
  _dragState.draggingSourceBlock = null;
  _dragState.draggingSlotIndex = null;
  _dragState.isOverSidebar = false;
  _dragState.isOverInvalidZone = false;
  _dragState.dropHandled = false;
  _detachDragOverListener();
}

function _laneInsertIndexToGlobal(allEntries: RotationEntry[], slotIndex: SlotIndex, laneInsertIndex: number): number {
  const laneEntries = getEntriesBySlot(allEntries, slotIndex);
  if (laneInsertIndex === 0) {
    if (laneEntries.length === 0) return allEntries.length - 1;
    const firstGlobalIndex = allEntries.findIndex((e) => e.id === laneEntries[0].id);
    return firstGlobalIndex - 1;
  } else {
    const prevLaneEntry = laneEntries[laneInsertIndex - 1];
    if (!prevLaneEntry) return allEntries.length - 1;
    return allEntries.findIndex((e) => e.id === prevLaneEntry.id);
  }
}

function _laneInsertIndexToGlobalExcludingSelf(allEntries: RotationEntry[], slotIndex: SlotIndex, laneInsertIndex: number, selfId: string): number {
  const laneEntriesWithoutSelf = getEntriesBySlot(allEntries, slotIndex).filter((e) => e.id !== selfId);
  if (laneInsertIndex === 0) {
    if (laneEntriesWithoutSelf.length === 0) return allEntries.length - 1;
    const firstGlobalIndex = allEntries.findIndex((e) => e.id === laneEntriesWithoutSelf[0].id);
    return firstGlobalIndex - 1;
  } else {
    const prevEntry = laneEntriesWithoutSelf[laneInsertIndex - 1];
    if (!prevEntry) return allEntries.length - 1;
    return allEntries.findIndex((e) => e.id === prevEntry.id);
  }
}

export function useBlockDrag() {
  const rotationStore = useRotationStore();
  const sidebarStore = useSidebarStore();
  const characterStore = useCharacterStore();
  const dragState = readonly(_dragState);

  function onSidebarDragStart(block: DefaultBlock | TemplateBlock): void {
    _dragState.isDragging = true;
    _dragState.sourceType = block.source === 'default' ? 'sidebar-default' : 'sidebar-template';
    _dragState.draggingId = block.id;
    _dragState.draggingSourceBlock = block;
    _dragState.draggingSlotIndex = null;
    _dragState.dropHandled = false;
    _dragState.isOverSidebar = false;
    _dragState.isOverInvalidZone = false;
    _attachDragOverListener();
  }

  function onRotationDragStart(entry: RotationEntry): void {
    _dragState.isDragging = true;
    _dragState.sourceType = 'rotation-instance';
    _dragState.draggingId = entry.id;
    _dragState.draggingSourceBlock = null;
    _dragState.draggingSlotIndex = entry.slotIndex;
    _dragState.dropHandled = false;
    _dragState.isOverSidebar = false;
    _dragState.isOverInvalidZone = false;
    _attachDragOverListener();
  }

  function setOverSidebar(val: boolean): void {
    if (_dragState.isDragging) _dragState.isOverSidebar = val;
  }

  function handleSidebarToLaneDrop(event: SortableEventLike, targetSlotIndex: SlotIndex): void {
    _dragState.dropHandled = true;
    const sourceBlock = _dragState.draggingSourceBlock;
    if (!sourceBlock) return;
    const targetCharacterId = characterStore.getCharacterIdBySlot(targetSlotIndex);
    if (!targetCharacterId) return;
    // 雙重防線：put 規則理論上已物理擋下跨角色拖放，此處再次校驗，
    // 防止特殊路徑（如 forceFallback 或未來改寫 put 邏輯時的疏漏）
    // 導致非法資料仍被寫入 store。
    const isCharacterMatch = sourceBlock.characterId === null || sourceBlock.characterId === targetCharacterId;
    if (!isCharacterMatch) return;
    const laneInsertIndex = event.newDraggableIndex ?? event.newIndex ?? 0;
    const globalInsertAfter = _laneInsertIndexToGlobal(rotationStore.entries, targetSlotIndex, laneInsertIndex);
    rotationStore.instantiateBlock(sourceBlock, targetSlotIndex, targetCharacterId, globalInsertAfter);
  }

  function handleSameLaneDrop(event: SortableEventLike, slotIndex: SlotIndex): void {
    _dragState.dropHandled = true;
    const draggingId = _dragState.draggingId;
    if (!draggingId) return;
    const allEntries = rotationStore.entries;
    const newLaneIndex = event.newDraggableIndex ?? event.newIndex ?? 0;
    const globalInsertAfter = _laneInsertIndexToGlobalExcludingSelf(allEntries, slotIndex, newLaneIndex, draggingId);
    rotationStore.moveBlock(draggingId, globalInsertAfter);
  }

  function handleDragEnd(_event?: SortableEventLike): void {
    if (!_dragState.isDragging) return;
    const { sourceType, draggingId, isOverSidebar, dropHandled, isOverInvalidZone } = _dragState;
    if (sourceType === 'rotation-instance' && draggingId) {
      if (isOverSidebar) {
        const entry = rotationStore.entries.find((e) => e.id === draggingId);
        if (entry) sidebarStore.serializeToTemplate(entry.block);
      } else if (!dropHandled && isOverInvalidZone) {
        rotationStore.deleteBlock(draggingId);
      }
    }
    _resetDragState();
  }

  function getRotationSortableOptions(_slotIndex: SlotIndex) {
    return {
      group: {
        name: 'rotation',
        pull: true,
        // 來源必須是 sidebar group，且 characterId 為 null（通用）或等於本泳道角色
        put: (_to: { options?: { group?: { name?: string } } }, from: { options?: { group?: { name?: string } } }) => {
          if (from?.options?.group?.name !== 'sidebar') return false;
          const sourceBlock = _dragState.draggingSourceBlock;
          if (!sourceBlock) return false;
          if (sourceBlock.characterId === null) return true;
          const targetCharacterId = characterStore.getCharacterIdBySlot(_slotIndex);
          return sourceBlock.characterId === targetCharacterId;
        },
      },
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
    } as const;
  }

  function getSidebarSortableOptions() {
    return {
      group: { name: 'sidebar', pull: 'clone', put: false },
      sort: false,
      animation: 0,
      ghostClass: 'sortable-ghost',
    } as const;
  }

  return {
    dragState,
    onSidebarDragStart,
    onRotationDragStart,
    setOverSidebar,
    handleSidebarToLaneDrop,
    handleSameLaneDrop,
    handleDragEnd,
    getRotationSortableOptions,
    getSidebarSortableOptions,
  };
}
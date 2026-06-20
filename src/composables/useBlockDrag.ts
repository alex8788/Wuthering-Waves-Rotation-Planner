import { reactive, readonly } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useSidebarStore } from '@/stores/useSidebarStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { getEntriesBySlot } from '@/utils/arrayHelpers';
import type { DefaultBlock, TemplateBlock } from '@/types/block';
import type { RotationEntry, DragSourceType } from '@/types/rotation';
import type { SlotIndex } from '@/types/character';

// 標記合法放置容器，供全域游標偵測 (mousemove/touchmove) 判斷是否懸停於無效區，藉此驅動危險警告樣式
export const DROP_ZONE_ATTRIBUTE = 'data-drop-zone';

export interface SortableEventLike {
  oldIndex?: number;
  newIndex?: number;
  oldDraggableIndex?: number;
  newDraggableIndex?: number;
}

interface DragState {
  isDragging: boolean;
  sourceType: DragSourceType | null;
  draggingId: string | null;
  draggingSourceBlock: DefaultBlock | TemplateBlock | null;
  draggingSlotIndex: SlotIndex | null;
  isOverSidebar: boolean;
  isOverInvalidZone: boolean; // 游標是否懸停在「非合法放置容器」之外（驅動危險警告樣式）
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

// 取得游標實際所在元素 (解決 touchmove 的 target 會停留在觸發起點的特性)
function _resolveHoveredElement(event: MouseEvent | TouchEvent): HTMLElement | null {
  if ('touches' in event) {
    const touch = event.touches[0];
    if (!touch) return null;
    return document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
  }
  return event.target as HTMLElement | null;
}

// 全域游標監聽：即時更新 isOverInvalidZone，不干擾 SortableJS 原有流程
function _handlePointerMove(event: MouseEvent | TouchEvent): void {
  if (!_dragState.isDragging) return;
  const target = _resolveHoveredElement(event);
  const isOverValidZone = !!target?.closest(`[${DROP_ZONE_ATTRIBUTE}]`);
  _dragState.isOverInvalidZone = !isOverValidZone;
}

let _isPointerListenerAttached = false;

function _attachPointerListener(): void {
  if (_isPointerListenerAttached) return;
  window.addEventListener('mousemove', _handlePointerMove, { passive: true });
  window.addEventListener('touchmove', _handlePointerMove, { passive: true });
  _isPointerListenerAttached = true;
}

function _detachPointerListener(): void {
  if (!_isPointerListenerAttached) return;
  window.removeEventListener('mousemove', _handlePointerMove);
  window.removeEventListener('touchmove', _handlePointerMove);
  _isPointerListenerAttached = false;
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
  _detachPointerListener();
}

// 將泳道內索引轉換為全域陣列索引 (用於新增區塊)
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

// 將泳道內索引轉換為全域陣列索引，並排除正在拖曳的區塊自身 (用於同道排序)
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

  // 側邊欄起拖
  function onSidebarDragStart(block: DefaultBlock | TemplateBlock): void {
    _dragState.isDragging = true;
    _dragState.sourceType = block.source === 'default' ? 'sidebar-default' : 'sidebar-template';
    _dragState.draggingId = block.id;
    _dragState.draggingSourceBlock = block;
    _dragState.draggingSlotIndex = null;
    _dragState.dropHandled = false;
    _dragState.isOverSidebar = false;
    _dragState.isOverInvalidZone = false;
    _attachPointerListener();
  }

  // 主軸起拖
  function onRotationDragStart(entry: RotationEntry): void {
    _dragState.isDragging = true;
    _dragState.sourceType = 'rotation-instance';
    _dragState.draggingId = entry.id;
    _dragState.draggingSourceBlock = null;
    _dragState.draggingSlotIndex = entry.slotIndex;
    _dragState.dropHandled = false;
    _dragState.isOverSidebar = false;
    _dragState.isOverInvalidZone = false;
    _attachPointerListener();
  }

  function setOverSidebar(val: boolean): void {
    if (_dragState.isDragging) _dragState.isOverSidebar = val;
  }

  // 側邊欄拖入主軸 (實例化)
  function handleSidebarToLaneDrop(event: SortableEventLike, targetSlotIndex: SlotIndex): void {
    _dragState.dropHandled = true;
    const sourceBlock = _dragState.draggingSourceBlock;
    if (!sourceBlock) return;
    const targetCharacterId = characterStore.getCharacterIdBySlot(targetSlotIndex);
    if (!targetCharacterId) return;
    
    // 雙重防線：確保來源區塊與目標泳道角色相符
    const isCharacterMatch = sourceBlock.characterId === null || sourceBlock.characterId === targetCharacterId;
    if (!isCharacterMatch) return;
    
    const laneInsertIndex = event.newDraggableIndex ?? event.newIndex ?? 0;
    const globalInsertAfter = _laneInsertIndexToGlobal(rotationStore.entries, targetSlotIndex, laneInsertIndex);
    rotationStore.instantiateBlock(sourceBlock, targetSlotIndex, targetCharacterId, globalInsertAfter);
  }

  // 主軸同道內排序
  function handleSameLaneDrop(event: SortableEventLike, slotIndex: SlotIndex): void {
    _dragState.dropHandled = true;
    const draggingId = _dragState.draggingId;
    if (!draggingId) return;
    
    const allEntries = rotationStore.entries;
    const newLaneIndex = event.newDraggableIndex ?? event.newIndex ?? 0;
    const globalInsertAfter = _laneInsertIndexToGlobalExcludingSelf(allEntries, slotIndex, newLaneIndex, draggingId);
    rotationStore.moveBlock(draggingId, globalInsertAfter);
  }

  // 拖曳結束：決策序列化、拖曳刪除或安全過關
  function handleDragEnd(): void {
    if (!_dragState.isDragging) return;
    const { sourceType, draggingId, isOverSidebar, dropHandled } = _dragState;
    
    if (sourceType === 'rotation-instance' && draggingId) {
      if (isOverSidebar) {
        const entry = rotationStore.entries.find((e) => e.id === draggingId);
        if (entry) sidebarStore.serializeToTemplate(entry.block);
      } else if (!dropHandled) {
        rotationStore.deleteBlock(draggingId);
      }
    }
    _resetDragState();
  }

  // 主軸專用拖曳設定
  function getRotationSortableOptions(_slotIndex: SlotIndex) {
    return {
      group: {
        name: 'rotation',
        pull: true,
        // 動態 put 規則：來源必須是 sidebar，且角色必須匹配（通用區塊 characterId 為 null 則放行）
        put: (to: { options?: { group?: { name?: string } } }, from: { options?: { group?: { name?: string } } }) => {
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
      // forceFallback: 改用 JS 渲染浮動分身，確保能套用自訂樣式，且掛載於 body 避免被裁切
      forceFallback: true,
      fallbackClass: 'sortable-drag',
      fallbackOnBody: true,
      fallbackTolerance: 3,
    } as const;
  }

  // 側邊欄專用拖曳設定
  function getSidebarSortableOptions() {
    return {
      group: { name: 'sidebar', pull: 'clone', put: false },
      sort: false,
      animation: 0,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      forceFallback: true,
      fallbackClass: 'sortable-drag',
      fallbackOnBody: true,
      fallbackTolerance: 3,
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
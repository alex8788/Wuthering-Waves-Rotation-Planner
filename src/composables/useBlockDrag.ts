import { reactive, readonly } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useSidebarStore } from '@/stores/useSidebarStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { getEntriesBySlot } from '@/utils/arrayHelpers';
import { generateUUID } from '@/utils/uuid';
import type { DefaultBlock, TemplateBlock } from '@/types/block';
import type { RotationEntry, DragSourceType } from '@/types/rotation';
import type { SlotIndex } from '@/types/character';

// 合法放置容器（泳道）需掛上此屬性，供 _handleDragOver 判斷游標是否在合法落點
export const DROP_ZONE_ATTRIBUTE = 'data-drop-zone';
// 可刪除區（主軸面板內、三條泳道之外的空白）掛此屬性。
// 三區語意：合法落點(泳道) > 可刪除區(主軸面板) > 其餘皆為禁止放置區(標題列/側邊欄/版面外)
export const DELETE_ZONE_ATTRIBUTE = 'data-delete-zone';

export interface SortableEventLike {
  oldIndex?: number;
  newIndex?: number;
  oldDraggableIndex?: number;
  newDraggableIndex?: number;
  to?: HTMLElement;   // 放置目標容器
  from?: HTMLElement; // 拖曳來源容器
  item?: HTMLElement; // 被拖放的 DOM 元素（跨清單複製時 = SortableJS 插入的克隆節點）
}

interface DragState {
  isDragging: boolean;
  sourceType: DragSourceType | null;
  draggingId: string | null;
  draggingSourceBlock: DefaultBlock | TemplateBlock | null;
  // 側邊欄拖曳開始時就先產生好的「未來實體 id」，讓拖曳預覽用的暫時物件
  // 與之後寫入 store 的正式 InstanceBlock 共用同一個 id（key 全程不變，
  // 避免 SortableJS 追蹤的 DOM 節點被 Vue 中途摧毀重建）
  pendingInstanceId: string | null;
  draggingSlotIndex: SlotIndex | null;
  isOverSidebar: boolean;
  // 游標不在合法落點（泳道）上：含可刪除區與禁止放置區兩種
  isOverInvalidZone: boolean;
  // 游標在可刪除區（主軸面板內、泳道之外）：主軸區塊在此放開才會刪除
  isOverDeleteZone: boolean;
  dropHandled: boolean;
}

const _dragState = reactive<DragState>({
  isDragging: false,
  sourceType: null,
  draggingId: null,
  draggingSourceBlock: null,
  pendingInstanceId: null,
  draggingSlotIndex: null,
  isOverSidebar: false,
  isOverInvalidZone: false,
  isOverDeleteZone: false,
  dropHandled: false,
});

// forceFallback 模式下 SortableJS 不會觸發原生 dragover，改用 mousemove
// 偵測游標是否在合法容器外（fallback 浮動分身預設 pointer-events: none，
// 滑鼠事件會正常穿透到底下的真實元素）
// forceFallback 模式下真正可見的被拖物件是 SortableJS 的靜態浮動克隆
// .sortable-fallback，拿不到 Vue 響應式更新，因此改用 <body> 全域 class + CSS
// 直接替浮動克隆上樣式。三區語意：
//   - 合法落點(泳道)            → 無警告
//   - 可刪除區(主軸面板內非泳道) → 主軸區塊：刪除紅紋；側邊欄區塊：禁止圖標(無法新增到空白處)
//   - 禁止放置區(其餘)          → 一律禁止圖標(放開彈回)
const DELETE_ZONE_BODY_CLASS = 'dragging-over-delete';
const FORBIDDEN_BODY_CLASS = 'dragging-forbidden';

function _handleDragOver(event: MouseEvent): void {
  if (!_dragState.isDragging) return;
  // 游標可能落在 document/window 等非 Element 目標上（無 closest 方法），需防護。
  const target = event.target instanceof Element ? event.target : null;
  const overValid = !!target?.closest(`[${DROP_ZONE_ATTRIBUTE}]`);
  const overDeleteZone = !overValid && !!target?.closest(`[${DELETE_ZONE_ATTRIBUTE}]`);
  const overForbidden = !overValid && !overDeleteZone;

  _dragState.isOverInvalidZone = !overValid;
  _dragState.isOverDeleteZone = overDeleteZone;

  const isRotationSource = _dragState.sourceType === 'rotation-instance';
  // 主軸區塊在可刪除區 → 紅紋；其餘非合法落點 → 禁止圖標（含側邊欄區塊在可刪除區）
  document.body.classList.toggle(DELETE_ZONE_BODY_CLASS, isRotationSource && overDeleteZone);
  document.body.classList.toggle(
    FORBIDDEN_BODY_CLASS,
    overForbidden || (!isRotationSource && overDeleteZone),
  );
}

let _isDragOverListenerAttached = false;

function _attachDragOverListener(): void {
  if (_isDragOverListenerAttached) return;
  window.addEventListener('mousemove', _handleDragOver);
  _isDragOverListenerAttached = true;
}

function _detachDragOverListener(): void {
  if (!_isDragOverListenerAttached) return;
  window.removeEventListener('mousemove', _handleDragOver);
  _isDragOverListenerAttached = false;
}

function _resetDragState(): void {
  _dragState.isDragging = false;
  _dragState.sourceType = null;
  _dragState.draggingId = null;
  _dragState.draggingSourceBlock = null;
  _dragState.pendingInstanceId = null;
  _dragState.draggingSlotIndex = null;
  _dragState.isOverSidebar = false;
  _dragState.isOverInvalidZone = false;
  _dragState.isOverDeleteZone = false;
  _dragState.dropHandled = false;
  document.body.classList.remove(DELETE_ZONE_BODY_CLASS);
  document.body.classList.remove(FORBIDDEN_BODY_CLASS);
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

  // 取得（必要時生成）本次側邊欄拖曳的「未來實體 id」。
  // SortableJS 的 :clone 與我們的 @start 事件觸發順序不保證，兩邊都透過此函式
  // 取得同一個 id，確保拖曳預覽暫時物件與正式寫入 store 的資料 id 一致。
  function getOrCreatePendingInstanceId(): string {
    if (!_dragState.pendingInstanceId) {
      _dragState.pendingInstanceId = generateUUID();
    }
    return _dragState.pendingInstanceId;
  }

  function onSidebarDragStart(block: DefaultBlock | TemplateBlock): void {
    const pendingInstanceId = getOrCreatePendingInstanceId();
    _dragState.isDragging = true;
    _dragState.sourceType = block.source === 'default' ? 'sidebar-default' : 'sidebar-template';
    _dragState.draggingId = pendingInstanceId;
    _dragState.draggingSourceBlock = block;
    _dragState.draggingSlotIndex = null;
    _dragState.dropHandled = false;
    _dragState.isOverSidebar = false;
    _dragState.isOverInvalidZone = false;
    _dragState.isOverDeleteZone = false;
    _attachDragOverListener();
  }

  function onRotationDragStart(entry: RotationEntry): void {
    _dragState.isDragging = true;
    _dragState.sourceType = 'rotation-instance';
    _dragState.draggingId = entry.id;
    _dragState.draggingSourceBlock = null;
    _dragState.pendingInstanceId = null;
    _dragState.draggingSlotIndex = entry.slotIndex;
    _dragState.dropHandled = false;
    _dragState.isOverSidebar = false;
    _dragState.isOverInvalidZone = false;
    _dragState.isOverDeleteZone = false;
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
    const pendingId = _dragState.pendingInstanceId ?? undefined;
    // 延後到 SortableJS 完成本次 drop 的同步清理（會清空套件全域 dragEl）之後
    // 再寫入 store。否則在 onAdd 同步改動 DOM 會打斷套件清理流程，使其全域 dragEl 殘留，
    // 導致 _onTapStart 的「if (dragEl) return」永遠擋掉之後所有泳道的拖曳起手（p1-1）。
    // 所需資料已於此處同步擷取為區域變數，故 handleDragEnd 同步重置 _dragState 不影響寫入。
    setTimeout(() => {
      rotationStore.instantiateBlock(
        sourceBlock,
        targetSlotIndex,
        targetCharacterId,
        globalInsertAfter,
        pendingId,
      );
    }, 0);
  }

  function handleSameLaneDrop(event: SortableEventLike, slotIndex: SlotIndex): void {
    _dragState.dropHandled = true;
    const draggingId = _dragState.draggingId;
    if (!draggingId) return;
    const allEntries = rotationStore.entries;
    const newLaneIndex = event.newDraggableIndex ?? event.newIndex ?? 0;
    const globalInsertAfter = _laneInsertIndexToGlobalExcludingSelf(allEntries, slotIndex, newLaneIndex, draggingId);
    // 與 handleSidebarToLaneDrop 同理：延後到 SortableJS 完成 drop 同步清理後再改 store，
    // 避免同步改動 DOM 打斷套件清理而導致全域 dragEl 殘留或區塊遺失。
    setTimeout(() => {
      rotationStore.moveBlock(draggingId, globalInsertAfter);
    }, 0);
  }

  function handleDragEnd(_event?: SortableEventLike): void {
    if (!_dragState.isDragging) return;
    const { sourceType, draggingId, isOverSidebar, dropHandled, isOverDeleteZone } = _dragState;
    if (sourceType === 'rotation-instance' && draggingId) {
      if (isOverSidebar) {
        const entry = rotationStore.entries.find((e) => e.id === draggingId);
        if (entry) sidebarStore.serializeToTemplate(entry.block);
      } else if (!dropHandled && isOverDeleteZone) {
        // 僅在「可刪除區」放開才刪除；禁止放置區（標題列/側邊欄/版面外）一律彈回不刪
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
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 3,
      // 關閉 SortableJS 內建自動捲動：開啟時其浮動分身會在接近可捲動容器
      // （側邊欄）邊緣時做位移補償，導致分身不跟手（位移極小）
      scroll: false,
    } as const;
  }

  function getSidebarSortableOptions() {
    return {
      group: { name: 'sidebar', pull: 'clone', put: false },
      sort: false,
      animation: 0,
      ghostClass: 'sortable-ghost',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 3,
      scroll: false,
    } as const;
  }

  return {
    dragState,
    getOrCreatePendingInstanceId,
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
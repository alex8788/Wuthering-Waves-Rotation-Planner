// ============================================================
// useBlockDrag.ts
// 拖曳行為的核心狀態機與業務邏輯層。
//
// 【架構說明】
// 此 composable 負責「拖曳的狀態管理」與「落點決策邏輯」，
// 不直接操作 DOM 或 VueDraggablePlus，保持與視圖層的解耦。
//
// 元件層（Phase 4）的 VueDraggablePlus 事件觸發時，
// 呼叫此 composable 提供的方法，再由方法更新 store。
//
// 【拖曳方向與對應處理函式】
//   側邊欄 → 泳道            : handleSidebarToLaneDrop()
//   泳道內排序（同泳道）      : handleSameLaneDrop()
//   泳道間移動（跨泳道）      : handleCrossLaneDrop()
//   泳道 → 側邊欄（序列化）  : 由 handleDragEnd() 偵測 isOverSidebar
//   泳道 → 無效區域（刪除）   : 由 handleDragEnd() 偵測 dropHandled
//
// 【狀態機流程】
//   idle
//     ↓ onSidebarDragStart / onRotationDragStart
//   dragging
//     ↓ handleSidebarToLaneDrop / handleSameLaneDrop / handleCrossLaneDrop
//       （dropHandled = true）
//     或 setOverSidebar(true)
//       （isOverSidebar = true）
//     ↓ handleDragEnd
//   idle（reset）
// ============================================================

import { reactive, readonly } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useSidebarStore } from '@/stores/useSidebarStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { getEntriesBySlot } from '@/utils/arrayHelpers';
import type { DefaultBlock, TemplateBlock } from '@/types/block';
import type { RotationEntry } from '@/types/rotation';
import type { SlotIndex } from '@/types/character';
import type { DragSourceType } from '@/types/rotation';

// ── SortableJS 事件最小介面 ───────────────────────────────
// 定義我們實際用到的欄位，避免直接依賴 sortablejs 套件型別。
// VueDraggablePlus 傳入的原始 SortableEvent 相容此介面。
export interface SortableEventLike {
  /** 拖曳項目在來源列表中的舊索引（含不可拖曳的元素） */
  oldIndex?: number;
  /** 拖曳項目在目標列表中的新索引（含不可拖曳的元素） */
  newIndex?: number;
  /** 拖曳項目在來源列表中的舊索引（僅計算可拖曳元素，更精確） */
  oldDraggableIndex?: number;
  /** 拖曳項目在目標列表中的新索引（僅計算可拖曳元素，更精確） */
  newDraggableIndex?: number;
}

// ── 模組層級單例狀態 ──────────────────────────────────────
// 拖曳狀態必須跨側邊欄與所有泳道元件共享，
// 因此使用模組層級變數（JS 模組的閉包特性保證全域唯一）。

interface DragState {
  /** 目前是否正在拖曳（SortableJS @start 觸發後才變 true） */
  isDragging: boolean;
  /** 拖曳來源的類型 */
  sourceType: DragSourceType | null;
  /**
   * 被拖曳的 block id（對應 InstanceBlock.id 或 DefaultBlock.id 或 TemplateBlock.id）。
   * 對於側邊欄來源，此為 DefaultBlock.id 或 TemplateBlock.id；
   * 對於主軸來源，此為 InstanceBlock.id（即 RotationEntry.id）。
   */
  draggingId: string | null;
  /**
   * 被拖曳的側邊欄區塊資料（僅 sourceType 為 sidebar-* 時有效）。
   * 存在此處是因為 SortableJS 的 @add 事件發生時，
   * 我們需要原始的 DefaultBlock 或 TemplateBlock 資料來呼叫 instantiateBlock。
   */
  draggingSourceBlock: DefaultBlock | TemplateBlock | null;
  /** 被拖曳區塊在主軸的原始泳道（僅 sourceType 為 rotation-instance 時有效） */
  draggingSlotIndex: SlotIndex | null;
  /**
   * 滑鼠目前是否懸停在側邊欄區域。
   * 由側邊欄元件透過 pointerenter / pointerleave 事件更新。
   * handleDragEnd 檢查此旗標以決定是否序列化。
   */
  isOverSidebar: boolean;
  /**
   * 是否已有合法的落點處理函式被呼叫過。
   * 用於 handleDragEnd 的「無效放置偵測」：
   * 若 handleDragEnd 被呼叫時此值仍為 false，代表區塊被拖到無效區域。
   */
  dropHandled: boolean;
}

const _dragState = reactive<DragState>({
  isDragging: false,
  sourceType: null,
  draggingId: null,
  draggingSourceBlock: null,
  draggingSlotIndex: null,
  isOverSidebar: false,
  dropHandled: false,
});

// ── 全域重置函式（模組層級，供 handleDragEnd 使用）────────
function _resetDragState(): void {
  _dragState.isDragging = false;
  _dragState.sourceType = null;
  _dragState.draggingId = null;
  _dragState.draggingSourceBlock = null;
  _dragState.draggingSlotIndex = null;
  _dragState.isOverSidebar = false;
  _dragState.dropHandled = false;
}

// ── 核心工具函式（模組層級純函式）────────────────────────

/**
 * _laneInsertIndexToGlobal：
 * 將「泳道內插入位置（laneInsertIndex）」轉換為「1D 陣列的 insertAfter 全域索引」。
 *
 * 這是本 composable 最關鍵的轉換函式，橋接了 VueDraggablePlus 的
 * 「泳道視角索引」與 store 的「1D 陣列全域索引」。
 *
 * 範例（假設 1D 陣列為 [CharA₀, CharB₁, CharA₂, CharB₃, CharA₄]）：
 *   泳道 0 = [CharA₀, CharA₂, CharA₄]
 *   laneInsertIndex = 0 → 插在 CharA₀ 之前 → insertAfter = -1（陣列最前方）
 *   laneInsertIndex = 1 → 插在 CharA₀ 之後 → insertAfter = 0
 *   laneInsertIndex = 2 → 插在 CharA₂ 之後 → insertAfter = 2
 *
 * @param allEntries  - 完整的 1D RotationArray（來自 store，尚未更新）
 * @param slotIndex   - 目標泳道索引
 * @param laneInsertIndex - 在泳道中插入的位置（0 = 最前方）
 * @returns insertAfter 全域索引（-1 代表插入陣列最前方）
 */
function _laneInsertIndexToGlobal(
  allEntries: RotationEntry[],
  slotIndex: SlotIndex,
  laneInsertIndex: number
): number {
  const laneEntries = getEntriesBySlot(allEntries, slotIndex);

  if (laneInsertIndex === 0) {
    // 插入在泳道最前方
    if (laneEntries.length === 0) {
      // 目標泳道目前為空 → 追加到整個 1D 陣列末尾
      return allEntries.length - 1;
    }
    // 找到此泳道第一個 entry 的全域索引
    const firstGlobalIndex = allEntries.findIndex(
      (e) => e.id === laneEntries[0].id
    );
    // 插入在它「之前」= insertAfter 為它的前一個位置
    return firstGlobalIndex - 1; // 若 firstGlobalIndex = 0，回傳 -1（陣列最前方）
  } else {
    // 插入在泳道第 laneInsertIndex 個 entry 之後
    // 即：laneEntries[laneInsertIndex - 1] 是要插在其右側的 entry
    const prevLaneEntry = laneEntries[laneInsertIndex - 1];
    if (!prevLaneEntry) {
      // 防禦性處理：索引超出範圍，追加到末尾
      return allEntries.length - 1;
    }
    return allEntries.findIndex((e) => e.id === prevLaneEntry.id);
  }
}

/**
 * _laneInsertIndexToGlobalExcludingSelf：
 * 與 _laneInsertIndexToGlobal 相同，但在計算時先從泳道 entries 中排除
 * 「目前被拖曳的 entry（self）」，適用於同泳道內排序的情境。
 *
 * 【為何需要排除 self？】
 * 當在同泳道內拖曳時，SortableJS 回報的 newDraggableIndex 是
 * 「移除被拖曳項目之後」的目標位置，如果不排除 self 就會有索引偏移。
 *
 * @param allEntries  - 完整的 1D RotationArray
 * @param slotIndex   - 目標泳道索引
 * @param laneInsertIndex - 目標泳道中的插入位置
 * @param selfId      - 要排除的 entry id（被拖曳的自身）
 * @returns insertAfter 全域索引
 */
function _laneInsertIndexToGlobalExcludingSelf(
  allEntries: RotationEntry[],
  slotIndex: SlotIndex,
  laneInsertIndex: number,
  selfId: string
): number {
  // 從泳道 entries 中排除自身，模擬「移除後」的狀態
  const laneEntriesWithoutSelf = getEntriesBySlot(allEntries, slotIndex).filter(
    (e) => e.id !== selfId
  );

  if (laneInsertIndex === 0) {
    if (laneEntriesWithoutSelf.length === 0) {
      // 排除自身後泳道為空，插入全域末尾
      return allEntries.length - 1;
    }
    const firstGlobalIndex = allEntries.findIndex(
      (e) => e.id === laneEntriesWithoutSelf[0].id
    );
    return firstGlobalIndex - 1;
  } else {
    const prevEntry = laneEntriesWithoutSelf[laneInsertIndex - 1];
    if (!prevEntry) {
      return allEntries.length - 1;
    }
    return allEntries.findIndex((e) => e.id === prevEntry.id);
  }
}

// ──────────────────────────────────────────────────────────
// 主 composable 函式
// ──────────────────────────────────────────────────────────
export function useBlockDrag() {
  const rotationStore = useRotationStore();
  const sidebarStore = useSidebarStore();
  const characterStore = useCharacterStore();

  // 對外暴露唯讀的拖曳狀態，防止元件直接修改（保持單向資料流）
  const dragState = readonly(_dragState);

  // ──────────────────────────────────────────
  // 拖曳起始
  // ──────────────────────────────────────────

  /**
   * onSidebarDragStart：當側邊欄的區塊開始被拖曳時呼叫。
   * 在 SidebarBlock 元件的 VueDraggable `@start` 事件中觸發。
   *
   * @param block - 被拖曳的側邊欄區塊（DefaultBlock 或 TemplateBlock）
   */
  function onSidebarDragStart(block: DefaultBlock | TemplateBlock): void {
    _dragState.isDragging = true;
    _dragState.sourceType =
      block.source === 'default' ? 'sidebar-default' : 'sidebar-template';
    _dragState.draggingId = block.id;
    _dragState.draggingSourceBlock = block;
    _dragState.draggingSlotIndex = null;
    _dragState.dropHandled = false;
    _dragState.isOverSidebar = false;
  }

  /**
   * onRotationDragStart：當主軸的 InstanceBlock 開始被拖曳時呼叫。
   * 在 Swimlane 元件的 VueDraggable `@start` 事件中觸發。
   *
   * @param entry - 被拖曳的 RotationEntry（含 block 與 slotIndex）
   */
  function onRotationDragStart(entry: RotationEntry): void {
    _dragState.isDragging = true;
    _dragState.sourceType = 'rotation-instance';
    _dragState.draggingId = entry.id;
    _dragState.draggingSourceBlock = null;
    _dragState.draggingSlotIndex = entry.slotIndex;
    _dragState.dropHandled = false;
    _dragState.isOverSidebar = false;
  }

  // ──────────────────────────────────────────
  // 放置區域偵測
  // ──────────────────────────────────────────

  /**
   * setOverSidebar：設定滑鼠是否懸停在側邊欄區域。
   * 由 SidebarPanel 元件在 pointerenter / pointerleave 事件中呼叫。
   *
   * 【為何用指標事件而非 SortableJS 的 group 接收？】
   * 設計文件要求「序列化為複製語意」：原區塊留在主軸。
   * 若讓 SortableJS 的 group 把區塊「拖入」側邊欄，SortableJS 會從
   * 來源列表中移除原項目，需要額外還原，反而複雜。
   * 改用指標事件偵測「懸停」，在 handleDragEnd 決策時使用，更為直覺。
   *
   * @param val - true = 滑鼠進入側邊欄，false = 滑鼠離開側邊欄
   */
  function setOverSidebar(val: boolean): void {
    if (_dragState.isDragging) {
      _dragState.isOverSidebar = val;
    }
  }

  // ──────────────────────────────────────────
  // 落點處理（成功放置）
  // ──────────────────────────────────────────

  /**
   * handleSidebarToLaneDrop：側邊欄區塊被放置到泳道時呼叫。
   * 在目標 Swimlane 的 VueDraggable `@add` 事件中，
   * 確認 sourceType 為 sidebar-* 時觸發。
   *
   * 行為：呼叫 store.instantiateBlock，產生新的 InstanceBlock 並加入 1D 陣列。
   *
   * @param event          - SortableJS 事件（提供 newDraggableIndex）
   * @param targetSlotIndex - 接收此次放置的泳道索引
   */
  function handleSidebarToLaneDrop(
    event: SortableEventLike,
    targetSlotIndex: SlotIndex
  ): void {
    _dragState.dropHandled = true;

    const sourceBlock = _dragState.draggingSourceBlock;
    if (!sourceBlock) {
      console.warn('[useBlockDrag.handleSidebarToLaneDrop] draggingSourceBlock 為 null，無法實例化');
      return;
    }

    // 取得目標泳道對應的角色 ID
    const targetCharacterId = characterStore.getCharacterIdBySlot(targetSlotIndex);
    if (!targetCharacterId) {
      console.warn(
        `[useBlockDrag.handleSidebarToLaneDrop] 泳道 ${targetSlotIndex} 尚未選角，拒絕放置`
      );
      return;
    }

    // 使用 newDraggableIndex 計算全域插入位置
    // newDraggableIndex 優先於 newIndex（更精確，排除不可拖曳的佔位元素）
    const laneInsertIndex = event.newDraggableIndex ?? event.newIndex ?? 0;
    const globalInsertAfter = _laneInsertIndexToGlobal(
      rotationStore.entries,
      targetSlotIndex,
      laneInsertIndex
    );

    rotationStore.instantiateBlock(
      sourceBlock,
      targetSlotIndex,
      targetCharacterId,
      globalInsertAfter
    );
  }

  /**
   * handleSameLaneDrop：同一泳道內的區塊重新排序時呼叫。
   * 在 Swimlane 的 VueDraggable `@update` 事件中觸發。
   *
   * 行為：呼叫 store.moveBlock，更新區塊在 1D 陣列中的位置（slotIndex 不變）。
   *
   * @param event     - SortableJS 事件（提供 oldDraggableIndex 與 newDraggableIndex）
   * @param slotIndex - 此泳道的索引
   */
  function handleSameLaneDrop(
    event: SortableEventLike,
    slotIndex: SlotIndex
  ): void {
    _dragState.dropHandled = true;

    const draggingId = _dragState.draggingId;
    if (!draggingId) return;

    const allEntries = rotationStore.entries;
    const newLaneIndex = event.newDraggableIndex ?? event.newIndex ?? 0;

    // 【索引轉換邏輯】
    // SortableJS 在 @update 觸發前已更新 DOM，但 store 尚未更新。
    // newDraggableIndex 是「排除被拖曳項目自身之後」的目標位置，
    // 因此必須使用 _laneInsertIndexToGlobalExcludingSelf 來排除自身。
    const globalInsertAfter = _laneInsertIndexToGlobalExcludingSelf(
      allEntries,
      slotIndex,
      newLaneIndex,
      draggingId
    );

    // slotIndex 與 characterId 不變（同泳道內移動）
    rotationStore.moveBlock(draggingId, globalInsertAfter);
  }

  // ──────────────────────────────────────────
  // 拖曳結束（統一決策點）
  // ──────────────────────────────────────────

  /**
   * handleDragEnd：所有拖曳操作結束時呼叫。
   * 在任何 VueDraggable 的 `@end` 事件中觸發。
   *
   * 此函式是整個拖曳狀態機的「終點」，負責處理兩種特殊情況，
   * 並在最後無條件重置所有拖曳狀態。
   *
   * 【決策邏輯】
   * Case 1：rotation-instance 被拖到側邊欄上方
   *   → isOverSidebar === true → 序列化為模板（原區塊保留在主軸）
   *
   * Case 2：rotation-instance 被拖到無效區域（任何合法放置區以外）
   *   → dropHandled === false && !isOverSidebar → 從主軸刪除區塊
   *
   * Case 3：所有其他情況（側邊欄成功放置、泳道內成功排序）
   *   → dropHandled === true → 不需額外處理，只重置狀態
   *
   * 【呼叫時機】
   * 此函式應在 SortableJS 的事件鏈中「最後」被呼叫。
   * SortableJS 事件觸發順序：@start → (@update|@add|@remove) → @end
   * 因此 dropHandled 在 @end 前就已被設定，決策邏輯是安全的。
   */
  function handleDragEnd(): void {
    if (!_dragState.isDragging) return;

    const { sourceType, draggingId, isOverSidebar, dropHandled } = _dragState;

    if (sourceType === 'rotation-instance' && draggingId) {
      if (isOverSidebar) {
        // Case 1：拖回側邊欄 → 序列化（複製語意，原區塊不刪除）
        const entry = rotationStore.entries.find((e) => e.id === draggingId);
        if (entry) {
          sidebarStore.serializeToTemplate(entry.block);
        }
        // 不呼叫 deleteBlock：原區塊留在主軸
      } else if (!dropHandled) {
        // Case 2：拖到無效區域 → 刪除
        rotationStore.deleteBlock(draggingId);
      }
      // Case 3：dropHandled === true → 已由其他處理函式完成，無需額外操作
    }

    // 無條件重置拖曳狀態（無論哪種 Case）
    _resetDragState();
  }

  // ──────────────────────────────────────────
  // SortableJS 選項工廠
  // ──────────────────────────────────────────

  /**
   * getRotationSortableOptions：回傳泳道使用的 SortableJS 選項。
   */
function getRotationSortableOptions(_slotIndex: SlotIndex) {
    return {
        group: {
            name: 'rotation',
            pull: true,         // 允許拖出（為了能拖到無效區刪除，或在側邊欄上方觸發序列化）
            put: ['sidebar'],   // 【關鍵修改】門禁森嚴：只接受來自 'sidebar' 的區塊拖入。嚴格禁止跨泳道！
        },
        animation: 150,         // 排序動畫時長（ms）
        ghostClass: 'sortable-ghost',   // 拖曳時原位置的佔位樣式
        chosenClass: 'sortable-chosen', // 被選取（按住）時的樣式
        dragClass: 'sortable-drag',     // 跟隨滑鼠移動的元素樣式
        forceFallback: false,           // 使用原生 HTML5 拖曳 API
        } as const;
}

  /**
   * getSidebarSortableOptions：回傳側邊欄使用的 SortableJS 選項。
   */
function getSidebarSortableOptions() {
    return {
      group: {
        name: 'sidebar',  // 獨立命名為 sidebar 群組
        pull: 'clone',    // 拖出時產生副本，原 DOM 保持不動
        put: false,       // 側邊欄不接受任何外部拖入
      },
      sort: false,  // 側邊欄區塊之間不可互相排序
      animation: 0, // 側邊欄不需排序動畫
      ghostClass: 'sortable-ghost',
    } as const;
  }

  // ──────────────────────────────────────────
  // 公開介面
  // ──────────────────────────────────────────
  return {
    /** 唯讀的拖曳狀態（供元件決定視覺呈現，如 danger stripe、drop indicator） */
    dragState,

    // 拖曳起始
    onSidebarDragStart,
    onRotationDragStart,

    // 放置區偵測
    setOverSidebar,

    // 落點處理
    handleSidebarToLaneDrop,
    handleSameLaneDrop,

    // 拖曳結束（統一決策）
    handleDragEnd,

    // SortableJS 選項工廠
    getRotationSortableOptions,
    getSidebarSortableOptions,
  };
}
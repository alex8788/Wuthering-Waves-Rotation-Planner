// ============================================================
// blockDrag/state.ts — 全域拖曳狀態（module 單例）＋區域標記常數（重構 R4）。
//
// 單一職責：只定義「拖曳中有哪些狀態」與其重置；不含 hit-test 幾何
// （見 resolver.ts）、不含落地 store 編排（見 commit.ts）。
// ============================================================

import { reactive } from 'vue';
import type { GeneralBlock, TemplateBlock } from '@/types/block';
import type { DragSourceType } from '@/types/rotation';
import type { SlotIndex } from '@/types/character';

// ── 區域標記屬性（掛在 DOM 上供 hit-test closest 判定）──────────
// 三區語意：合法落點(泳道) > 可刪除區(主軸面板內非泳道) > 禁止放置區(其餘)。
export const DROP_ZONE_ATTRIBUTE = 'data-drop-zone';
export const DELETE_ZONE_ATTRIBUTE = 'data-delete-zone';
// 側邊欄序列化區（自訂模板面板）。主軸區塊拖到此處放開 → 序列化為角色模板。
export const SIDEBAR_ZONE_ATTRIBUTE = 'data-sidebar-zone';

// ── <body> 全域 class（forceFallback 浮動克隆拿不到 Vue 響應式，
//    警告樣式改用 body class + CSS 直接套在克隆上）──────────────
export const DELETE_ZONE_BODY_CLASS = 'dragging-over-delete';
export const FORBIDDEN_BODY_CLASS = 'dragging-forbidden';
export const SIDEBAR_ZONE_BODY_CLASS = 'dragging-over-sidebar';

export interface SortableEventLike {
  oldIndex?: number;
  newIndex?: number;
  oldDraggableIndex?: number;
  newDraggableIndex?: number;
  to?: HTMLElement;   // 放置目標容器
  from?: HTMLElement; // 拖曳來源容器
  item?: HTMLElement; // 被拖放的 DOM 元素（跨清單複製時 = SortableJS 插入的克隆節點）
}

export interface DragState {
  isDragging: boolean;
  sourceType: DragSourceType | null;
  draggingId: string | null;
  // 多選拖曳：整組被拖曳的區塊 id（依全域順序）。單拖時為 [draggingId]。
  draggingIds: string[];
  draggingSourceBlock: GeneralBlock | TemplateBlock | null;
  // 側邊欄多選拖曳：整組來源模板，依「選取先後順序」排列（落地時由左而右解壓縮插入）。
  // 單拖時為 [draggingSourceBlock]。
  draggingSourceBlocks: (GeneralBlock | TemplateBlock)[];
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
  // ── 自製落點預覽（single thread 跨泳道同步擠出）──────────────
  // 全域 after-index：插在此索引之後（語意同 store moveBlock/instantiateBlock 的 afterIndex；
  // -1=最前、length-1=最後）。null = 目前無合法落點（游標在泳道外/禁止區/跨泳道）。
  previewInsertAfterIndex: number | null;
  // 落點空欄寬度（px）。主軸來源＝被拖區塊原欄寬；側邊欄＝浮動分身寬度。
  draggingWidth: number;
  // 落點所在泳道（畫單欄虛框用）。null = 無合法落點。
  previewSlotIndex: SlotIndex | null;
}

/** 全域拖曳狀態單例（可變版；對外唯讀視圖由 useBlockDrag 門面提供）。 */
export const dragStateInternal = reactive<DragState>({
  isDragging: false,
  sourceType: null,
  draggingId: null,
  draggingIds: [],
  draggingSourceBlock: null,
  draggingSourceBlocks: [],
  pendingInstanceId: null,
  draggingSlotIndex: null,
  isOverSidebar: false,
  isOverInvalidZone: false,
  isOverDeleteZone: false,
  previewInsertAfterIndex: null,
  draggingWidth: 0,
  previewSlotIndex: null,
});

/** 移除三區警告的 <body> 全域 class。 */
export function clearZoneBodyClasses(): void {
  document.body.classList.remove(DELETE_ZONE_BODY_CLASS);
  document.body.classList.remove(FORBIDDEN_BODY_CLASS);
  document.body.classList.remove(SIDEBAR_ZONE_BODY_CLASS);
}

/** 重置全部拖曳狀態欄位與 body class（不含事件監聽收尾，由門面負責）。 */
export function resetDragState(): void {
  dragStateInternal.isDragging = false;
  dragStateInternal.sourceType = null;
  dragStateInternal.draggingId = null;
  dragStateInternal.draggingIds = [];
  dragStateInternal.draggingSourceBlock = null;
  dragStateInternal.draggingSourceBlocks = [];
  dragStateInternal.pendingInstanceId = null;
  dragStateInternal.draggingSlotIndex = null;
  dragStateInternal.isOverSidebar = false;
  dragStateInternal.isOverInvalidZone = false;
  dragStateInternal.isOverDeleteZone = false;
  dragStateInternal.previewInsertAfterIndex = null;
  dragStateInternal.draggingWidth = 0;
  dragStateInternal.previewSlotIndex = null;
  clearZoneBodyClasses();
}

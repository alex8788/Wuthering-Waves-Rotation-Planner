// ============================================================
// rotation.ts
// 定義「輸出軸（Rotation）」的核心資料結構。
// 本專案最關鍵的設計決策：三條泳道在底層為「一維陣列」。
// ============================================================

import type { Block } from './block';
import type { SlotIndex } from './character';

/**
 * RotationEntry：1D 輸出軸陣列中的單一元素。
 *
 * 【設計說明】
 * 雖然視覺上有三條泳道（Swimlane），但底層資料結構是一個扁平的
 * RotationEntry[]，每個元素除了攜帶 Block 資料，還記錄了它「屬於
 * 哪條泳道（slotIndex）」，渲染時再依此分配到對應的泳道顯示。
 *
 * 排序規則：
 * Index(Block_n) = Index(Block_n-1) + 1
 * 陣列的索引即代表時間先後，索引越小代表越早施放。
 */
export interface RotationEntry {
  /**
   * 此條目在 1D 陣列中的唯一識別，直接對應內部 Block.id。
   * 方便 dnd-kit / VueDraggablePlus 使用 :key 綁定，也方便從陣列中快速查找、刪除。
   */
  id: string; // === block.id

  /**
   * 此區塊所屬的泳道索引（0=上方角色, 1=中間角色, 2=下方角色）。
   * 此值與 block.characterId 的綁定狀態應保持一致。
   */
  slotIndex: SlotIndex;

  /**
   * 完整的區塊實體資料。
   * 採用「內嵌（Embed）」而非「外鍵（Foreign Key）」設計，
   * 避免在渲染時需要跨 store 查找，提升效能。
   */
  block: Block;
}

/**
 * RotationArray：整個輸出軸的核心資料型別。
 * Pinia store 中的 `entries` 欄位即為此型別。
 *
 * 操作此陣列時，請務必使用 src/utils/arrayHelpers.ts 中的純函式，
 * 不要在元件層直接進行 splice / push，確保邏輯集中且可測試。
 */
export type RotationArray = RotationEntry[];

/**
 * RotationAxis：單一「輸出軸」(類似 Excel 工作表分頁)。
 *
 * 【設計說明】
 * 多開輸出軸時,每個輸出軸各自擁有一條獨立的 RotationArray;隊伍(角色槽)、
 * 泳道顯示順序、Undo/Redo 歷史則跨所有輸出軸共用(見 useRotationStore /
 * useHistory)。store 對外仍暴露一個名為 `entries` 的 writable computed,
 * 代理到「作用中輸出軸」的 entries,使既有的時間軸操作零改動。
 */
export interface RotationAxis {
  /** 輸出軸唯一識別碼。 */
  id: string;
  /** 顯示於底部頁籤的名稱。 */
  name: string;
  /** 此輸出軸自己的 1D 時間軸陣列。 */
  entries: RotationArray;
}

/**
 * DragSource：描述拖曳動作的來源資訊。
 * 用於 useBlockDrag composable 中判斷拖曳行為的類型。
 */
export type DragSourceType =
  | 'sidebar-default'    // 從側邊欄「預設區塊」區域拖出
  | 'sidebar-template'   // 從側邊欄「自訂模板」區域拖出
  | 'rotation-instance'; // 從主時間軸拖動現有實體

/**
 * DragPayload：拖曳事件攜帶的完整資料。
 * 在 VueDraggablePlus 的拖曳事件中，透過 data-* 屬性或 provide/inject 傳遞。
 */
export interface DragPayload {
  /** 拖曳來源類型 */
  sourceType: DragSourceType;

  /**
   * 來源區塊的統一識別碼。
   * 因底層已泛用化，不論來源為何，皆直接對應區塊介面中的泛用 `id`。
   */
  sourceId: string;

  /**
   * 目標槽位索引。
   * 拖曳懸停在某條泳道上方時即時更新，放開時用於決定寫入哪個 slotIndex。
   */
  targetSlotIndex: SlotIndex | null;

  /**
   * 目標插入位置，代表插入在 1D 陣列的哪個索引之後。
   * -1 代表插入在陣列最前方；
   * entries.length - 1 代表插入在最後方（全局尾端吸附的預設值）。
   */
  targetInsertAfterIndex: number;
}
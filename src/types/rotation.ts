// ============================================================
// rotation.ts — 輸出軸（Rotation）核心資料結構。
//
// 設計原則：
//   - 三條泳道在底層是「一維扁平陣列」RotationEntry[]，每個元素
//     以 slotIndex 記錄自己屬於哪條泳道，渲染時再分流。
//   - 陣列索引即時間先後（越小越早施放）。
//   - 多輸出軸：每軸各持一條 entries；隊伍/泳道順序/歷史跨軸共用。
//   - 操作陣列請走 utils/arrayHelpers.ts 的純函式，勿在元件層 splice/push。
// ============================================================

import type { Block } from './block';
import type { SlotIndex } from './character';

/** 1D 輸出軸陣列的單一元素：內嵌完整 Block 資料，避免渲染時跨 store 查找。 */
export interface RotationEntry {
  /** 唯一識別，等同 block.id，供 :key 綁定與查找。 */
  id: string; // === block.id
  /** 所屬泳道索引（0/1/2）；應與 block.characterId 一致。 */
  slotIndex: SlotIndex;
  /** 完整區塊實體資料（內嵌而非外鍵）。 */
  block: Block;
}

/** 整條輸出軸型別。 */
export type RotationArray = RotationEntry[];

/** 單一輸出軸（類似 Excel 工作表分頁）：各持一條獨立 entries。 */
export interface RotationAxis {
  id: string;
  /** 顯示於底部頁籤的名稱。 */
  name: string;
  entries: RotationArray;
}

/** 拖曳來源類型。 */
export type DragSourceType =
  | 'sidebar-general'    // 側邊欄通用區塊
  | 'sidebar-template'   // 側邊欄自訂模板
  | 'rotation-instance'; // 主軸現有實體

/** 拖曳事件攜帶的資料。 */
export interface DragPayload {
  sourceType: DragSourceType;
  /** 來源區塊的統一 id（不論來源皆對應區塊的泛用 id）。 */
  sourceId: string;
  /** 目標泳道索引；懸停時即時更新，放開時決定寫入哪條泳道。 */
  targetSlotIndex: SlotIndex | null;
  /** 插入在 1D 陣列哪個索引之後（-1=最前、length-1=最後）。 */
  targetInsertAfterIndex: number;
}

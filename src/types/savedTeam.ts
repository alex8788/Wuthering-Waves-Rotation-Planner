// ============================================================
// savedTeam.ts — 隊伍存檔（SavedTeam）型別。
//
// 一筆存檔＝當前完整工作狀態的具名快照：三角色槽 + 所有輸出軸（含全部區塊）
// + 作用中軸 + 泳道順序。此組欄位與 useHistory 的 Snapshot 一致（即「完整
// 工作狀態」），故載入某存檔可完整還原一場工作階段。
// ============================================================

import type { RotationAxis } from './rotation';
import type { CharacterSlots, SlotIndex } from './character';

/** 一筆隊伍存檔。 */
export interface SavedTeam {
  /** 唯一識別碼（UUID）。 */
  id: string;
  /** 使用者命名（不可與其他存檔重名）。 */
  name: string;
  /** 建立時間戳（ms）。 */
  createdAt: number;
  /** 最後更新時間戳（ms）；置頂排序後的次要排序鍵。 */
  updatedAt: number;
  /** 是否置頂。 */
  pinned: boolean;

  // ── 完整狀態快照 ──────────────────────────────
  /** 三角色槽（tuple 固定長度 3）。 */
  slots: CharacterSlots;
  /** 所有輸出軸（含每軸全部 entries）。 */
  axes: RotationAxis[];
  /** 作用中輸出軸 id。 */
  activeAxisId: string;
  /** 泳道顯示順序。 */
  laneOrder: SlotIndex[];
}

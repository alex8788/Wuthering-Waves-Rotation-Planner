// ============================================================
// hotkey.ts — 熱鍵輸入模式的對映表型別。
//
// 設計決策（見 DesignDocument/HotkeyInputMode.md §2）：
//   - 以 label 為準（非模板 id）：命中即插入自由區塊，免處理模板刪改的懸空引用。
//   - hotkey 一律存 KeyboardEvent.code（物理鍵，免疫 CapsLock／輸入法），
//     滑鼠鍵則用 'MouseLeft' / 'MouseRight' 兩個保留字。
//   - pressType 預留 tap/hold；Stage 2 僅用 tap，hold 判定於 Stage 3 接上。
//   - id 為本專案內部用（列表渲染 key／編輯定位）；非設計文件的三欄之一。
// ============================================================

/** 按法：單擊 / 長按。結構預留未來擴充（如 'double'）。 */
export type PressType = 'tap' | 'hold';

/** 單條熱鍵對映。衝突單位＝hotkey + pressType（見 useHotkeyMap.findConflict）。 */
export interface HotkeyMapEntry {
  /** 內部唯一鍵（列表渲染／編輯定位用）。 */
  id: string;
  /** 插入區塊時使用的文字。 */
  label: string;
  /** KeyboardEvent.code（如 'KeyE'）或 'MouseLeft' / 'MouseRight'。 */
  hotkey: string;
  /** 單擊 / 長按。 */
  pressType: PressType;
}

/**
 * 入場技長按捷徑：固定綁定 Digit1/2/3、pressType 恆為 hold 的特殊條目。
 *   - 與 1/2/3 單擊切軸並存：keydown 立即切軸，長按（≥300ms）於該軸末端插入入場技。
 *   - 鍵位與長按型別鎖定不可改；使用者僅能改 label 與啟停（enabled）。
 *   - 全域三條（slot 1/2/3 對應畫面上第 1/2/3 條泳道），與使用者自訂條目分開儲存。
 */
export interface IntroHotkeyEntry {
  /** 對應 Digit{slot} 與畫面顯示序（第 slot 條泳道）。 */
  slot: 1 | 2 | 3;
  /** 插入區塊時使用的文字（可編輯）。 */
  label: string;
  /** 是否啟用此捷徑（停用時長按 1/2/3 不插入，僅切軸）。 */
  enabled: boolean;
}

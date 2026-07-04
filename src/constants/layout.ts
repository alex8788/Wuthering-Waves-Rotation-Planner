// ============================================================
// layout.ts — 版面幾何常數（單一來源）。
//
// TRACK_GAP_PX 為主軸區塊間距的唯一真相：
//   - JS：RotationBoard 的 FLIP 位移解析式、落點空欄/多選合計寬度加總。
//   - CSS：Swimlane / RotationExportView 以 :style 注入 --track-gap 使用。
// 兩端共用同一常數 → 幾何模型與實際渲染永遠一致（重構 R1）。
// ============================================================

/** 主軸區塊間距的「預設值」（px）：泳道 grid gap、匯出視圖 column-gap、FLIP/寬度數學共用。
 *  執行期實際值可由設定調整（useSettings.trackGapPx，以此為預設）；消費端一律讀設定，
 *  本常數僅作為設定的初始值與單一真相。 */
export const TRACK_GAP_PX = 2;

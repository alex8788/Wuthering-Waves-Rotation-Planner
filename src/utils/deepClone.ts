// ============================================================
// deepClone.ts
// 深拷貝工具函式。
//
// 【用途】
// 從側邊欄拖入主軸時，必須對區塊資料進行「深拷貝（Deep Copy）」，
// 確保主軸上的每個 InstanceBlock 都是獨立的記憶體物件，
// 不會因為共用參考而導致修改一個區塊時意外影響其他區塊。
// ============================================================

/**
 * deepClone：對任意可序列化的物件進行深拷貝。
 *
 * 【實作策略比較】
 *
 * 方案 A：structuredClone()（本函式採用）
 *   - 現代瀏覽器原生支援（Chrome 98+、Firefox 94+、Safari 15.4+）
 *   - 可正確處理巢狀陣列、Date、Map、Set 等型別
 *   - 效能優於 JSON 序列化方案
 *   - 無法複製 Function、DOM 元素、Symbol 屬性（本專案資料結構不包含這些）
 *
 * 方案 B：JSON.parse(JSON.stringify(obj))
 *   - 相容性最廣，但無法處理 undefined、Date、循環引用
 *   - 本專案資料結構均為純 JSON 可序列化物件，此方案理論上可行
 *   - 但效能較差，且語意上不如 structuredClone 明確
 *
 * 結論：優先使用 structuredClone，提供 JSON 方案作為回退。
 *
 * @template T - 要複製的物件型別，必須為可序列化的純資料物件
 * @param obj - 要深拷貝的來源物件
 * @returns 與 obj 結構完全相同但記憶體位址獨立的新物件
 */
export function deepClone<T>(obj: T): T {
  // 優先使用原生 structuredClone（現代瀏覽器支援）
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      // structuredClone 無法複製 Vue reactive proxy，會丟出 DataCloneError。
      // 本專案的 Block 皆為純資料（無 undefined/Date/循環引用），改用 JSON
      // 序列化既安全又能「讀穿」proxy，取得乾淨的純資料副本。
      return JSON.parse(JSON.stringify(obj)) as T;
    }
  }

  // 回退方案：JSON 序列化（相容舊版環境）
  // 警告：若 obj 包含 undefined 值的屬性，序列化後該屬性會消失。
  // 本專案的 Block 資料結構不使用 undefined，故此回退方案安全。
  return JSON.parse(JSON.stringify(obj)) as T;
}
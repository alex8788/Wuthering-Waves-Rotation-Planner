// ============================================================
// arrayHelpers.ts — 1D 輸出軸陣列的純函式操作。
//
// 設計原則：全部為純函式 —— 不改動傳入陣列（回傳新陣列）、無副作用。
// ============================================================

import type { RotationEntry } from '../types/rotation';

/** 在 afterIndex 之後插入一個條目（afterIndex 超出末尾時 splice 自動夾到尾端＝追加）。 */
export function insertEntryAfterIndex(
  entries: RotationEntry[],
  newEntry: RotationEntry,
  afterIndex: number
): RotationEntry[] {
  const result = [...entries];
  result.splice(afterIndex + 1, 0, newEntry);
  return result;
}

/** 移除指定 id 的條目。 */
export function removeEntryById(
  entries: RotationEntry[],
  id: string
): RotationEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

/** 批量移除多個 id（轉 Set 以 O(1) 查找）。 */
export function removeEntriesByIds(
  entries: RotationEntry[],
  ids: string[]
): RotationEntry[] {
  const idSet = new Set(ids);
  return entries.filter((entry) => !idSet.has(entry.id));
}

/** 把 fromIndex 的條目移到 toInsertAfterIndex 之後（含移除後索引校正）。 */
export function moveEntry(
  entries: RotationEntry[],
  fromIndex: number,
  toInsertAfterIndex: number
): RotationEntry[] {
  if (fromIndex < 0 || fromIndex >= entries.length) {
    console.warn(`[arrayHelpers.moveEntry] fromIndex ${fromIndex} 超出陣列範圍`);
    return [...entries];
  }

  const result = [...entries];
  const [movedEntry] = result.splice(fromIndex, 1);

  // 移除後若目標在 fromIndex 之後，索引整體前移一格。
  const correctedInsertAfter =
    toInsertAfterIndex >= fromIndex ? toInsertAfterIndex - 1 : toInsertAfterIndex;
  const insertAt = correctedInsertAfter === -1 ? 0 : correctedInsertAfter + 1;
  result.splice(insertAt, 0, movedEntry);

  return result;
}

/** 透過 id 查索引，未找到回 -1。 */
export function findEntryIndexById(
  entries: RotationEntry[],
  id: string
): number {
  return entries.findIndex((entry) => entry.id === id);
}

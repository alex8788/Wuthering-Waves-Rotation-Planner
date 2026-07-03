// ============================================================
// characters.ts — 鳴潮全角色名單（半動態:generated + overrides 合併）。
//
// 資料來源（build-time import，App 維持全靜態、離線可用）:
//   - data/characters.generated.json：爬蟲(GitHub Actions 週更)擁有，每次全覆蓋，勿手改。
//   - data/characters.overrides.json：人工擁有，Record<id, Partial<Character>>，逐欄疊加。
//
// 合併規則:
//   - 以 generated 為底，overrides 依 id 做欄位級覆蓋（{ ...gen, ...override }）。
//   - overrides 有、generated 沒有的 id → 追加末尾（允許手動新增角色）。
//   - 順序 = generated 陣列順序（已依「屬性分組、5★ 在 4★ 前」手排）+ overrides 新增者。
//
// 設計原則（不變）:
//   - 顏色一律由 element 經 getElementColor 決定，資料不存主題色。
// ============================================================

import type { Character } from '../types/character';
import generatedJson from '../data/characters.generated.json';
import overridesJson from '../data/characters.overrides.json';

// JSON 的 element/rarity 會被推論成 string/number，故經 unknown 斷言回精確型別。
const generated = generatedJson as unknown as Character[];
const overrides = overridesJson as unknown as Record<string, Partial<Character>>;

// 疊加:Map 以插入序保留 generated 原順序，overrides-only 新角色再追加末尾。
const mergedById = new Map<string, Character>();
for (const c of generated) {
  mergedById.set(c.id, { ...c, ...overrides[c.id] });
}
for (const [id, partial] of Object.entries(overrides)) {
  if (!mergedById.has(id)) {
    // overrides 新增的角色須自備完整必填欄位（id/nameZh/element/rarity）。
    mergedById.set(id, { id, ...partial } as Character);
  }
}

/** 鳴潮全角色名單（合併後）。 */
export const WUWA_CHARACTERS: Character[] = Array.from(mergedById.values());

/** 以 id 為鍵的角色查找表（O(1)，避免渲染迴圈用 Array.find）。 */
export const CHARACTER_MAP: Record<string, Character> = Object.fromEntries(
  WUWA_CHARACTERS.map((c) => [c.id, c]),
);

// ============================================================
// defaultBlocks.ts — 側邊欄「通用預設區塊」的初始種子。
//
// 這 7 個為首次載入時寫入 useDefaultBlockStore 的種子內容；之後使用者可自由
// 增刪改（見該 store）。此處僅作為預設資料來源，非執行期唯一真相。
//
// 設計原則：
//   - id 用靜態 'default-{skill}' 格式，方便比對來源、重整不變。
//   - color 用中性深色，表明為系統預設而非角色專屬。
//   - characterId 固定 null（通用，不綁角色）。
// ============================================================

import type { DefaultBlock } from '../types/block';

/** 七個基礎招式的預設區塊。 */
export const DEFAULT_BLOCKS: DefaultBlock[] = [
  {
    id: 'default-A',
    label: 'A',
    color: '#64748B', // Slate-500：中性灰藍
    characterId: null,
    source: 'default',
    tags: [],
  },
  {
    id: 'default-Z',
    label: 'Z',
    color: '#64748B',
    characterId: null,
    source: 'default',
    tags: [],
  },
  {
    id: 'default-E',
    label: 'E',
    color: '#64748B',
    characterId: null,
    source: 'default',
    tags: [],
  },
  {
    id: 'default-R',
    label: 'R',
    color: '#64748B',
    characterId: null,
    source: 'default',
    tags: [],
  },
  {
    id: 'default-Q',
    label: 'Q',
    color: '#64748B',
    characterId: null,
    source: 'default',
    tags: [],
  },
  {
    id: 'default-D',
    label: 'D',
    color: '#64748B',
    characterId: null,
    source: 'default',
    tags: [],
  },
  {
    id: 'default-SWAP',
    label: 'Outro',
    color: '#64748B',
    characterId: null,
    source: 'default',
    tags: [],
  },
];

/** 以 id 為鍵的查找表（O(1)）。 */
export const DEFAULT_BLOCK_MAP: Record<string, DefaultBlock> =
  Object.fromEntries(DEFAULT_BLOCKS.map((b) => [b.id, b]));
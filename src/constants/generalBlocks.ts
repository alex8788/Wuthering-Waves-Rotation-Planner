// ============================================================
// generalBlocks.ts — 側邊欄「通用區塊」的初始種子。
//
// 這 7 個為首次載入時寫入 useGeneralBlockStore 的種子內容；之後使用者可自由
// 增刪改（見該 store）。此處僅作為預設資料來源，非執行期唯一真相。
//
// 設計原則：
//   - id 用靜態 'general-{skill}' 格式，方便比對來源、重整不變。
//   - color 用中性深色，表明為系統預設而非角色專屬。
//   - characterId 固定 null（通用，不綁角色）。
// ============================================================

import type { GeneralBlock } from '../types/block';

/** 七個基礎招式的通用區塊種子。 */
export const GENERAL_BLOCKS: GeneralBlock[] = [
  { id: 'general-A', label: 'A', color: '#64748B', characterId: null, source: 'general', tags: [] },
  { id: 'general-Z', label: 'Z', color: '#64748B', characterId: null, source: 'general', tags: [] },
  { id: 'general-E', label: 'E', color: '#64748B', characterId: null, source: 'general', tags: [] },
  { id: 'general-R', label: 'R', color: '#64748B', characterId: null, source: 'general', tags: [] },
  { id: 'general-Q', label: 'Q', color: '#64748B', characterId: null, source: 'general', tags: [] },
  { id: 'general-D', label: 'D', color: '#64748B', characterId: null, source: 'general', tags: [] },
  { id: 'general-SWAP', label: 'Intro', color: '#64748B', characterId: null, source: 'general', tags: [] },
];

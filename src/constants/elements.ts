// ============================================================
// elements.ts
// 鳴潮「屬性（元素）→ 代表色」映射。
//
// 設計：同屬性的角色一律共用同一個顏色（色點、色條、主軸區塊顏色完全統一），
// 不再各角色一色。需要「依屬性上色」的地方統一呼叫 getElementColor()，
// 確保泳道 header、角色選單頁籤、主軸區塊三者顏色一致。
// ============================================================

import type { CharacterElement } from '../types/character';

/** 六屬性代表色（hex）。 */
export const ELEMENT_COLORS: Record<CharacterElement, string> = {
  氣動: '#10B981', // 翠綠
  冷凝: '#38BDF8', // 冰藍
  導電: '#A78BFA', // 紫
  湮滅: '#F87171', // 暗紅
  衍射: '#FBBF24', // 金黃
  熱熔: '#FB923C', // 橘紅
};

/** 未選角 / 無屬性時的中性色。 */
export const NEUTRAL_COLOR = '#64748B';

/** 取得屬性代表色；傳入 null/未知時回中性色。 */
export function getElementColor(element: CharacterElement | null | undefined): string {
  if (!element) return NEUTRAL_COLOR;
  return ELEMENT_COLORS[element] ?? NEUTRAL_COLOR;
}

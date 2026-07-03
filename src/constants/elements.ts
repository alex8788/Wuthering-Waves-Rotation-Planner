// ============================================================
// elements.ts
// 鳴潮「屬性（元素）→ 代表色」映射。
//
// 設計：同屬性的角色一律共用同一個顏色（色點、色條、主軸區塊顏色完全統一），
// 不再各角色一色。需要「依屬性上色」的地方統一呼叫 getElementColor()，
// 確保泳道 header、角色選單頁籤、主軸區塊三者顏色一致。
// ============================================================

import type { CharacterElement } from '../types/character';
import elementsGenerated from '../data/elements.generated.json';

// 屬性圖示（爬蟲下載自 encore，build-time import）：name → 本地 webp 路徑。
const ELEMENT_ICONS: Partial<Record<CharacterElement, string>> = Object.fromEntries(
  (elementsGenerated as { name: string; icon?: string }[])
    .filter((e) => e.icon)
    .map((e) => [e.name, e.icon as string]),
);

/** 六屬性代表色（hex）。 */
export const ELEMENT_COLORS: Record<CharacterElement, string> = {
  氣動: '#55FFB5', // 翠綠
  冷凝: '#41AEFB', // 冰藍
  導電: '#B46BFF', // 紫
  湮滅: '#E549A5', // 桃紅
  衍射: '#EECC22', // 金黃
  熱熔: '#F0744E', // 橘紅
};

/** 未選角 / 無屬性時的中性色。 */
export const NEUTRAL_COLOR = '#64748B';

/** 取得屬性代表色；傳入 null/未知時回中性色。 */
export function getElementColor(element: CharacterElement | null | undefined): string {
  if (!element) return NEUTRAL_COLOR;
  return ELEMENT_COLORS[element] ?? NEUTRAL_COLOR;
}

/** 取得屬性圖示本地路徑；無對應（資料尚未下載）時回 null。 */
export function getElementIcon(element: CharacterElement | null | undefined): string | null {
  if (!element) return null;
  return ELEMENT_ICONS[element] ?? null;
}

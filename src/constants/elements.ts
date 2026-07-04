// ============================================================
// elements.ts
// 鳴潮「屬性（元素）」資料驅動層：順序、代表色、圖示的單一來源。
//
// 資料來源（build-time import，與角色資料同一套 generated + overrides 模式）：
//   - elements.generated.json  ：爬蟲產出（name / slug / icon），順序即正典序。
//   - elements.overrides.json  ：人工持有（color 必填、icon 可覆寫）；
//                                新屬性出現時用 scripts/add-element.mjs 補色。
//
// 設計：同屬性角色共用同一顏色（色條、頁籤、主軸區塊統一），一律經
// getElementColor() 取色；未知屬性/缺色 → NEUTRAL_COLOR（中性灰）fallback，
// 保證遊戲新增屬性當週 UI 不壞版，只是暫以灰色呈現直到人工補色。
// ============================================================

import type { CharacterElement } from '../types/character';
import elementsGenerated from '../data/elements.generated.json';
import elementsOverrides from '../data/elements.overrides.json';

interface GeneratedElement {
  name: string;
  slug: string;
  icon?: string;
}
interface ElementOverride {
  color?: string;
  icon?: string;
}

const generated = elementsGenerated as GeneratedElement[];
const overrides = elementsOverrides as Record<string, ElementOverride>;

/** 屬性正典順序（角色選單頁籤、資料排序共用）＝ generated 檔案順序。 */
export const ELEMENT_ORDER: CharacterElement[] = generated.map((e) => e.name);

/** 屬性代表色（hex）：由 overrides 建構（人工維護，非硬編碼於程式）。 */
export const ELEMENT_COLORS: Record<CharacterElement, string> = Object.fromEntries(
  Object.entries(overrides)
    .filter(([, o]) => o.color)
    .map(([name, o]) => [name, o.color as string]),
);

// 屬性圖示：generated（爬蟲下載）為底，overrides.icon 可逐屬性覆寫。
const ELEMENT_ICONS: Record<string, string> = Object.fromEntries(
  generated
    .map((e) => [e.name, overrides[e.name]?.icon ?? e.icon] as const)
    .filter((pair): pair is readonly [string, string] => !!pair[1]),
);

/** 未選角 / 無屬性 / 未知屬性時的中性色。 */
export const NEUTRAL_COLOR = '#64748B';

/** 取得屬性代表色；傳入 null / 未知 / 缺色（新屬性尚未補色）時回中性色。 */
export function getElementColor(element: CharacterElement | null | undefined): string {
  if (!element) return NEUTRAL_COLOR;
  return ELEMENT_COLORS[element] ?? NEUTRAL_COLOR;
}

/** 取得屬性圖示本地路徑；無對應（資料尚未下載）時回 null。 */
export function getElementIcon(element: CharacterElement | null | undefined): string | null {
  if (!element) return null;
  return ELEMENT_ICONS[element] ?? null;
}

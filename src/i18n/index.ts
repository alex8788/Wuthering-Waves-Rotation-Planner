// ============================================================
// i18n/index.ts — 多語系實例與顯示名工具（單一來源）。
//
// 兩套系統（見 DesignDocument/維護指南/語言系統維護SOP.md）：
//   A. 介面文字：src/locales/<lang>.json 字典，經 t() 查表。
//   B. 資料名稱：角色/屬性名內嵌多語欄位（nameZh/nameEn，爬蟲供給），
//      經 characterDisplayName / elementDisplayName 依 locale 切換。
//
// 語言狀態單一來源＝useSettings.language（持久化）；此處 watch 同步到
// i18n.global.locale（響應式 → 切換即時生效免重整）。缺字 fallback 回 zh-TW。
// ============================================================

import { createI18n } from 'vue-i18n';
import { watch } from 'vue';
import { useSettings } from '@/composables/state/useSettings';
import zhTW from '@/locales/zh-TW.json';
import en from '@/locales/en.json';
import elementsGenerated from '@/data/elements.generated.json';
import elementsOverrides from '@/data/elements.overrides.json';
import type { Character, CharacterElement } from '@/types/character';

/** 支援的介面語言（設定選單選項與 locale 檔一一對應）。 */
export const SUPPORTED_LOCALES = [
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
] as const;

const { settings } = useSettings();

export const i18n = createI18n({
  legacy: false, // Composition API 模式
  globalInjection: true, // 模板可直接用 $t()
  locale: settings.value.language,
  fallbackLocale: 'en', // 缺字回英文（不出現空白/key 原文；en 為預設主語言）
  messages: { 'zh-TW': zhTW, en },
  // 缺字 fallback 是預期行為（en 可分批補），不刷 console 警告。
  missingWarn: false,
  fallbackWarn: false,
});

// 設定 → locale 單向同步（設定為單一來源；locale 是響應式，全畫面即時更新）。
watch(
  () => settings.value.language,
  (lang) => {
    i18n.global.locale.value = lang as 'zh-TW' | 'en';
  },
);

/** 元件外（stores/composables）用的全域 t()。 */
export const t = i18n.global.t;

/** 目前是否為中文介面（資料名稱 zh/en 切換用）。 */
function isZh(): boolean {
  return i18n.global.locale.value.startsWith('zh');
}

/** 角色顯示名：依 locale 回 nameZh / nameEn（缺英文名 fallback 中文）。 */
export function characterDisplayName(
  c: Pick<Character, 'nameZh' | 'nameEn'> | null | undefined,
): string {
  if (!c) return '';
  return isZh() ? c.nameZh : c.nameEn || c.nameZh;
}

// 屬性英文名查找表：generated（爬蟲）為底、overrides（人工）可覆寫。
const ELEMENT_NAME_EN: Record<string, string> = Object.fromEntries(
  (elementsGenerated as { name: string; nameEn?: string }[])
    .map((e) => {
      const override = (elementsOverrides as Record<string, { nameEn?: string }>)[e.name];
      return [e.name, override?.nameEn ?? e.nameEn] as const;
    })
    .filter((pair): pair is readonly [string, string] => !!pair[1]),
);

/** 屬性顯示名：依 locale 回中文（資料鍵本身）或英文（缺翻 fallback 中文）。 */
export function elementDisplayName(element: CharacterElement | null | undefined): string {
  if (!element) return '';
  return isZh() ? element : (ELEMENT_NAME_EN[element] ?? element);
}

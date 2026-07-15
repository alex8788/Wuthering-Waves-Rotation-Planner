// seo-locales.mjs 的型別宣告（給 vite.config.ts 的 TS 檢查用；
// 執行端 node 直接跑 .mjs，不經 TS）。
export interface SeoLocale {
  code: 'en' | 'zh-TW' | 'zh-CN' | 'ja' | 'ko';
  dir: string;
  htmlLang: string;
  hreflang: string;
  ogLocale: string;
  jsonLdName: string;
  title: string;
  description: string;
  crawler: { h1: string; p: string };
}
export declare const LOCALES: SeoLocale[];
export declare function fillHtml(template: string, code: SeoLocale['code']): string;
export declare function renderSitemap(): string;

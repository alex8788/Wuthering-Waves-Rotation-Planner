// ============================================================
// generate-seo-pages.mjs — build 後產出多語 SEO 頁面。
//
// 讀 dist/index.html（此時 Vite 已注入正式 JS/CSS 標籤，但 SEO 佔位符
// 仍保留），以 seo-locales.mjs 填充後輸出：
//   dist/index.html        → 英文版（x-default）
//   dist/zh-tw/index.html  → 繁中版
//   dist/zh-cn/index.html  → 簡中版
//   dist/ja/index.html     → 日文版
//   dist/ko/index.html     → 韓文版
// 並重新產出 dist/sitemap.xml（覆蓋 public/ 複製過來的單網址版本）。
//
// 由 npm run build 的最後一步呼叫（見 package.json）。
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { LOCALES, fillHtml, renderSitemap } from './seo-locales.mjs';

const distDir = new URL('../dist/', import.meta.url);
const template = readFileSync(new URL('index.html', distDir), 'utf8');

if (!template.includes('<!--SEO_TAGS-->') || !template.includes('%SEO_LANG%')) {
  throw new Error('[generate-seo-pages] dist/index.html 缺少 SEO 佔位符，請確認 index.html 模板未被改壞');
}

for (const loc of LOCALES) {
  const outDir = loc.dir ? new URL(`${loc.dir}/`, distDir) : distDir;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(new URL('index.html', outDir), fillHtml(template, loc.code));
  console.log(`[generate-seo-pages] ${loc.code} → ${loc.dir || '(root)'}/index.html`);
}

writeFileSync(new URL('sitemap.xml', distDir), renderSitemap());
console.log('[generate-seo-pages] sitemap.xml 已更新（5 個語言網址 + hreflang）');

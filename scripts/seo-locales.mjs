// ============================================================
// seo-locales.mjs — 多語 SEO 頁面的單一資料來源與模板填充邏輯。
//
// 供兩處共用：
//   1. vite.config.ts 的 dev 插件（開發時把 index.html 佔位符填成英文版）
//   2. scripts/generate-seo-pages.mjs（build 後產出 5 份語言頁）
//
// 佔位符（index.html）：
//   %SEO_LANG%        → <html lang> 屬性值
//   <!--SEO_TAGS-->   → title / description / canonical / hreflang / OG / JSON-LD
//   <!--SEO_CRAWLER--> → 給不執行 JS 的爬蟲讀的隱藏 h1 + p（真人看不到）
//
// title/description 直接讀 src/locales/<lang>.json 的 seo 鍵（單一來源），
// vue-i18n 的 {'|'} 字面量寫法在此轉回「|」。
// ============================================================

import { readFileSync } from 'node:fs';

const SITE = 'https://wuthering-waves-rotation-planner.vercel.app';

function readLocaleSeo(file) {
  const json = JSON.parse(readFileSync(new URL(`../src/locales/${file}`, import.meta.url), 'utf8'));
  return {
    title: json.seo.title.replaceAll("{'|'}", '|'),
    description: json.seo.description,
  };
}

/**
 * 各語言頁定義。
 * - dir：dist 下的子目錄（'' = 根目錄，作為英文版與 x-default）
 * - htmlLang：<html lang>；hreflang：hreflang 標註值；ogLocale：og:locale
 * - crawler：給爬蟲的隱藏 h1/p（該語言的完整介紹文字）
 */
export const LOCALES = [
  {
    code: 'en',
    dir: '',
    htmlLang: 'en',
    hreflang: 'en',
    ogLocale: 'en_US',
    jsonLdName: 'WuWa Rotation Planner (Wuthering Waves Rotation Editor)',
    crawler: {
      h1: 'WuWa Rotation Planner — Wuthering Waves Rotation Editor',
      p: 'An online team rotation planning tool for Wuthering Waves. Drag and drop to arrange the order of character skills, with custom block templates, team saves, undo/redo, and PNG/SVG image export. Available in Traditional Chinese, Simplified Chinese, English, Japanese, and Korean. Runs entirely in your browser — no installation, registration, or login required.',
    },
    ...readLocaleSeo('en.json'),
  },
  {
    code: 'zh-TW',
    dir: 'zh-tw',
    htmlLang: 'zh-Hant',
    hreflang: 'zh-Hant',
    ogLocale: 'zh_TW',
    jsonLdName: '鳴潮排軸編輯器 (WuWa Rotation Planner)',
    crawler: {
      h1: '鳴潮排軸編輯器 — WuWa Rotation Planner',
      p: '線上的《鳴潮》(Wuthering Waves) 隊伍排軸規劃工具。以拖曳方式編排角色技能施放順序，支援自訂區塊模板、隊伍存檔、復原/重做、PNG/SVG圖片匯出。支援繁體中文、簡體中文、English、日本語、한국어。本工具為純前端應用，資料儲存在你的瀏覽器，無需安裝、註冊與登入。',
    },
    ...readLocaleSeo('zh-TW.json'),
  },
  {
    code: 'zh-CN',
    dir: 'zh-cn',
    htmlLang: 'zh-Hans',
    hreflang: 'zh-Hans',
    ogLocale: 'zh_CN',
    jsonLdName: '鸣潮排轴编辑器 (WuWa Rotation Planner)',
    crawler: {
      h1: '鸣潮排轴编辑器 — WuWa Rotation Planner',
      p: '在线的《鸣潮》(Wuthering Waves) 队伍排轴规划工具。以拖拽方式编排角色技能释放顺序，支持自定义区块模板、队伍存档、撤销/重做、PNG/SVG图片导出。支持简体中文、繁体中文、English、日本語、한국어。本工具为纯前端应用，数据保存在你的浏览器中，无需安装、注册与登录。',
    },
    ...readLocaleSeo('zh-CN.json'),
  },
  {
    code: 'ja',
    dir: 'ja',
    htmlLang: 'ja',
    hreflang: 'ja',
    ogLocale: 'ja_JP',
    jsonLdName: '鳴潮 ローテーションエディター (WuWa Rotation Planner)',
    crawler: {
      h1: '鳴潮 ローテーションエディター — WuWa Rotation Planner',
      p: '『鳴潮』(Wuthering Waves) のオンライン・ローテーション（軸）作成ツール。ドラッグ＆ドロップでキャラのスキル順を編集でき、カスタムブロックテンプレート、編成セーブ、元に戻す/やり直し、PNG/SVG画像出力に対応。日本語・English・한국어・繁体字中国語・簡体字中国語に対応。データはブラウザに保存され、インストール・登録・ログインは不要です。',
    },
    ...readLocaleSeo('ja.json'),
  },
  {
    code: 'ko',
    dir: 'ko',
    htmlLang: 'ko',
    hreflang: 'ko',
    ogLocale: 'ko_KR',
    jsonLdName: '명조 로테이션 편집기 (WuWa Rotation Planner)',
    crawler: {
      h1: '명조 로테이션 편집기 — WuWa Rotation Planner',
      p: '온라인 《명조: 워더링 웨이브》(Wuthering Waves) 파티 로테이션 계획 툴. 드래그 앤 드롭으로 캐릭터 스킬 순서를 편집하고, 커스텀 블록 템플릿, 파티 저장, 실행 취소/다시 실행, PNG/SVG 이미지 내보내기를 지원합니다. 한국어・English・日本語・번체 중국어・간체 중국어 지원. 데이터는 브라우저에 저장되며 설치・가입・로그인이 필요 없습니다.',
    },
    ...readLocaleSeo('ko.json'),
  },
];

/** 該語言頁的正式網址（根目錄 = 英文版）。 */
function pageUrl(loc) {
  return loc.dir ? `${SITE}/${loc.dir}/` : `${SITE}/`;
}

/** hreflang 交叉標註：每頁都列出全部語言版本 + x-default（指向根/英文版）。 */
function hreflangLinks() {
  const links = LOCALES.map((l) => `    <link rel="alternate" hreflang="${l.hreflang}" href="${pageUrl(l)}" />`);
  links.push(`    <link rel="alternate" hreflang="x-default" href="${SITE}/" />`);
  return links.join('\n');
}

function escapeHtml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** 產生 <!--SEO_TAGS--> 佔位符的完整內容。 */
function renderSeoTags(loc) {
  const url = pageUrl(loc);
  const title = escapeHtml(loc.title);
  const desc = escapeHtml(loc.description);
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: loc.jsonLdName,
    url,
    description: loc.description,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web',
    inLanguage: ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko'],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  });
  return `<meta name="description" content="${desc}" />
    <link rel="canonical" href="${url}" />
    <title>${title}</title>

${hreflangLinks()}

    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url}" />
    <meta property="og:locale" content="${loc.ogLocale}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:site_name" content="WuWa Rotation Planner" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${SITE}/og-image.png" />

    <script type="application/ld+json">${jsonLd}</script>`;
}

/** 產生 <!--SEO_CRAWLER--> 佔位符的完整內容（隱藏 h1 + p）。 */
function renderCrawlerHtml(loc) {
  return `<h1>${escapeHtml(loc.crawler.h1)}</h1>
        <p>${escapeHtml(loc.crawler.p)}</p>`;
}

/** 把模板 HTML 的三個佔位符全部填成指定語言。 */
export function fillHtml(template, code) {
  const loc = LOCALES.find((l) => l.code === code);
  if (!loc) throw new Error(`[seo-locales] 未知語言代碼：${code}`);
  return template
    .replaceAll('%SEO_LANG%', loc.htmlLang)
    .replaceAll('<!--SEO_TAGS-->', renderSeoTags(loc))
    .replaceAll('<!--SEO_CRAWLER-->', renderCrawlerHtml(loc));
}

/** 產生 sitemap.xml 內容（5 個網址，各自帶 hreflang 交叉標註）。 */
export function renderSitemap() {
  const alternates = [
    ...LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${pageUrl(l)}" />`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/" />`,
  ].join('\n');
  const urls = LOCALES.map(
    (l) => `  <url>
    <loc>${pageUrl(l)}</loc>
${alternates}
    <changefreq>monthly</changefreq>
    <priority>${l.dir ? '0.8' : '1.0'}</priority>
  </url>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

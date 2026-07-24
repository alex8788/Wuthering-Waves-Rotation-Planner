// ============================================================
// crawl-characters.mjs — encore.moe 角色資料爬蟲（P3，只在 CI / 本機 node 執行）。
//
// 流程：
//   1. 抓 5 份 roleList（zh-Hant/zh-Hans/en/ja/ko），以數字 Id join，拿各語顯示名
//      （角色 nameZh/nameZhCn/nameEn/nameJa/nameKo + 屬性各語名）。zh-Hant 為主鍵語言。
//   2. id 對應採乙方案：scripts/id-map.json（encore 數字 Id → 我們的 kebab id）。
//      - 對照表沒有的 Id → 先用中文名比對現有 generated.json 認領舊 id；
//        再沒有 → 由英文名轉 kebab-case 自動生成，並在摘要標記【新角色】。
//      - 解析結果一律寫回 id-map.json 持久化。
//   3. schema 驗證：rarity ∈ {4,5}、名稱/屬性非空；任一筆失敗
//      → 整批中止不落檔（避免髒資料入庫）。
//      屬性「不驗白名單」：新屬性自動吸納（slug 由 en 名 kebab 化、圖示照常
//      下載），摘要標記⚠提醒用 scripts/add-element.mjs 補色碼。
//   4. 下載頭像 → public/assets/characters/<id>.webp（已存在即跳過）。
//   5. 寫 src/data/characters.generated.json（屬性分組、5★ 在 4★ 前、組內依
//      encore Id 降冪＝發布新→舊 → 輸出穩定、git diff 乾淨）。
//   6. 印出 diff 摘要（新增 / 變更 / 移除），供 CI 塞進 commit 訊息。
//
// 用法：node scripts/crawl-characters.mjs [--skip-avatars]
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_BASE = 'https://api-v2.encore.moe/api'; // 官方 OpenAPI 確認的主 server
// 遊戲資源代理台：Element.Icon 是「/Game/...」部分路徑，需前綴此 base 並補 .webp
// （與角色 RoleHeadIcon 的完整網址同一台 https://api.encore.moe/resource/Data/Game/...）。
const RESOURCE_BASE = 'https://api.encore.moe/resource/Data';
const GENERATED_PATH = join(ROOT, 'src/data/characters.generated.json');
const ELEMENTS_GENERATED_PATH = join(ROOT, 'src/data/elements.generated.json');
const ID_MAP_PATH = join(ROOT, 'scripts/id-map.json');
const AVATAR_DIR = join(ROOT, 'public/assets/characters');
const ELEMENT_DIR = join(ROOT, 'public/assets/elements');

// 屬性清單不再硬編碼白名單：以舊 elements.generated.json 為「已知集合」，
// roleList 出現的新屬性自動吸納（slug 由 en 屬性名 kebab 化），只在摘要
// 標記⚠疑似新屬性提醒人工補色（scripts/add-element.mjs），不中止整批。
const ELEMENTS_OVERRIDES_PATH = join(ROOT, 'src/data/elements.overrides.json');
const SKIP_AVATARS = process.argv.includes('--skip-avatars');

// ── 工具 ─────────────────────────────────────────────────────

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 英文名 → kebab-case id（新角色的自動 id；可再用 id-map/overrides 人工修正）。 */
function kebab(nameEn) {
  return nameEn
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // 去變音符號
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchRoleList(lang) {
  const url = `${API_BASE}/${lang}/character`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.roleList)) throw new Error(`${url} 回傳缺 roleList`);
  return data.roleList;
}

/** 下載圖片到 destPath（已存在則跳過）；回傳是否確實存在。禮貌間隔 150ms。 */
async function downloadImage(url, destPath) {
  if (existsSync(destPath)) return true;
  mkdirSync(dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) return false;
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  await new Promise((r) => setTimeout(r, 150));
  return true;
}

// ── 主流程 ───────────────────────────────────────────────────

async function main() {
  // 1. 抓 5 種語言並以數字 Id join（zh-Hant 為主鍵語言）
  const [zhList, zhCnList, enList, jaList, koList] = await Promise.all([
    fetchRoleList('zh-Hant'),
    fetchRoleList('zh-Hans'),
    fetchRoleList('en'),
    fetchRoleList('ja'),
    fetchRoleList('ko'),
  ]);
  const enById = new Map(enList.map((r) => [r.Id, r]));
  const zhCnById = new Map(zhCnList.map((r) => [r.Id, r]));
  const jaById = new Map(jaList.map((r) => [r.Id, r]));
  const koById = new Map(koList.map((r) => [r.Id, r]));

  // 2. id 對應（乙方案）
  const idMap = readJson(ID_MAP_PATH, {}); // { "<encoreId>": "<our-id>" }
  const oldGenerated = readJson(GENERATED_PATH, []);
  // 中文名認領時正規化間隔號（舊資料用全形「・」、encore 用半形「·」）
  const normZh = (s) => s.replaceAll('・', '·');
  const oldByNameZh = new Map(oldGenerated.map((c) => [normZh(c.nameZh), c]));
  const oldById = new Map(oldGenerated.map((c) => [c.id, c]));

  const newChars = []; // 摘要用：本次全新角色
  const characters = [];
  const seenIds = new Set(); // encore 把男/女漂泊者列為兩筆同名角色 → 按解析後 id 去重
  const errors = [];

  for (const zh of zhList) {
    const en = enById.get(zh.Id);
    const nameEn = en?.Name ?? '';

    // 解析我們的 id：id-map → 中文名認領舊 id → 英文名 kebab（標記新角色）
    let ourId = idMap[String(zh.Id)];
    if (!ourId) {
      const claimed = oldByNameZh.get(normZh(zh.Name));
      if (claimed) {
        ourId = claimed.id;
      } else {
        ourId = kebab(nameEn) || `char-${zh.Id}`;
        if (!seenIds.has(ourId) && !oldById.has(ourId)) {
          newChars.push(`${zh.Name}（${nameEn || '?'}）→ id: ${ourId}`);
        }
      }
      idMap[String(zh.Id)] = ourId;
    }
    if (seenIds.has(ourId)) continue; // 同 id 第二筆（男/女漂泊者）→ 跳過
    seenIds.add(ourId);

    const c = {
      id: ourId,
      nameZh: zh.Name,
      element: zh.Element?.Name,
      rarity: zh.QualityId,
      encoreId: zh.Id, // 排序用，落檔前移除
    };
    // 多語顯示名（i18n Part 2）：有值才寫入，缺則交由顯示層回退。
    const nameZhCn = zhCnById.get(zh.Id)?.Name;
    const nameJa = jaById.get(zh.Id)?.Name;
    const nameKo = koById.get(zh.Id)?.Name;
    if (nameZhCn) c.nameZhCn = nameZhCn;
    if (nameEn) c.nameEn = nameEn;
    if (nameJa) c.nameJa = nameJa;
    if (nameKo) c.nameKo = nameKo;

    // 3. schema 驗證（任一筆失敗 → 整批中止）。
    //    屬性只驗「非空」不驗白名單：新屬性走自動吸納（見屬性區塊），不中止。
    if (!c.id || !c.nameZh) errors.push(`Id ${zh.Id}: 名稱/id 為空`);
    if (!c.element) errors.push(`${c.nameZh}: 屬性為空`);
    if (c.rarity !== 4 && c.rarity !== 5) errors.push(`${c.nameZh}: 星級異常 ${c.rarity}`);

    // 4. 頭像
    if (!SKIP_AVATARS && zh.RoleHeadIcon) {
      const avatarPath = join(AVATAR_DIR, `${ourId}.webp`);
      if (!existsSync(avatarPath)) {
        mkdirSync(AVATAR_DIR, { recursive: true });
        const res = await fetch(zh.RoleHeadIcon);
        if (!res.ok) {
          errors.push(`${c.nameZh}: 頭像下載失敗 HTTP ${res.status}`);
        } else {
          writeFileSync(avatarPath, Buffer.from(await res.arrayBuffer()));
          await new Promise((r) => setTimeout(r, 150)); // 禮貌間隔
        }
      }
      if (existsSync(avatarPath)) c.avatar = `/assets/characters/${ourId}.webp`;
    } else if (oldById.get(ourId)?.avatar) {
      c.avatar = oldById.get(ourId).avatar; // skip 模式保留舊頭像欄位
    }

    characters.push(c);
  }

  // 屬性（元素）資料 + 圖示：從 roleList 收集不重複 Element（不限 6 個），
  // 順序＝舊 generated 檔順序在前、本次新發現的屬性依出現序 append 在後
  // （輸出穩定、diff 乾淨）。新屬性自動吸納：slug 由 en 屬性名 kebab 化，
  // 圖示照常下載，並在摘要標記⚠提醒補色（不中止整批）。
  const elemByName = new Map(); // zh 屬性名 → zh Element 物件
  const elemNames = new Map(); // zh 屬性名 → { en, zhCn, ja, ko } 各語屬性名
  for (const zh of zhList) {
    const e = zh.Element;
    if (!e?.Name) continue;
    if (!elemByName.has(e.Name)) {
      elemByName.set(e.Name, e);
      elemNames.set(e.Name, {
        en: enById.get(zh.Id)?.Element?.Name,
        zhCn: zhCnById.get(zh.Id)?.Element?.Name,
        ja: jaById.get(zh.Id)?.Element?.Name,
        ko: koById.get(zh.Id)?.Element?.Name,
      });
    }
  }
  const oldElements = readJson(ELEMENTS_GENERATED_PATH, []);
  const oldElemByName = new Map(oldElements.map((e) => [e.name, e]));
  const elementOverrides = readJson(ELEMENTS_OVERRIDES_PATH, {});
  const usedSlugs = new Set(oldElements.map((e) => e.slug));

  // 順序：舊檔順序（僅保留本次仍存在者）＋ 新屬性依 roleList 出現序
  const elementOrder = [
    ...oldElements.map((e) => e.name).filter((n) => elemByName.has(n)),
    ...[...elemByName.keys()].filter((n) => !oldElemByName.has(n)),
  ];

  const newElements = []; // 摘要用：本次新發現的屬性
  const elementsOut = [];
  for (const name of elementOrder) {
    const e = elemByName.get(name);
    const old = oldElemByName.get(name);

    const names = elemNames.get(name) ?? {};
    // slug：舊檔沿用；新屬性由 en 屬性名 kebab 化，取不到/撞名退 element-<n>
    let slug = old?.slug;
    if (!slug) {
      slug = kebab(names.en ?? '') || `element-${elementsOut.length + 1}`;
      while (usedSlugs.has(slug)) slug = `${slug}-x`;
      newElements.push(`${name}（slug: ${slug}）`);
    }
    usedSlugs.add(slug);

    const iconPath = join(ELEMENT_DIR, `${slug}.webp`);
    const entry = { name, slug };
    // 屬性多語顯示名（i18n 顯示用）：本次取得；取不到沿用舊檔。
    const nameEn = names.en ?? old?.nameEn;
    const nameZhCn = names.zhCn ?? old?.nameZhCn;
    const nameJa = names.ja ?? old?.nameJa;
    const nameKo = names.ko ?? old?.nameKo;
    if (nameEn) entry.nameEn = nameEn;
    if (nameZhCn) entry.nameZhCn = nameZhCn;
    if (nameJa) entry.nameJa = nameJa;
    if (nameKo) entry.nameKo = nameKo;
    if (!SKIP_AVATARS && e.Icon) {
      const ok = await downloadImage(`${RESOURCE_BASE}${e.Icon}.webp`, iconPath);
      if (!ok) errors.push(`屬性 ${name}: 圖示下載失敗`);
    }
    if (existsSync(iconPath)) entry.icon = `/assets/elements/${slug}.webp`;
    else if (old?.icon) entry.icon = old.icon; // skip 模式保留舊圖示欄位
    elementsOut.push(entry);
  }

  if (errors.length > 0) {
    console.error('❌ schema 驗證失敗，整批中止：');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  // 5. 穩定排序：屬性順序（舊檔序＋新屬性在後）→ 5★ 前 4★ 後 →
  //    encore Id 降冪（新角色在前，等同「發布日期新→舊」；選單組內由上到下即新到舊）。
  characters.sort(
    (a, b) =>
      elementOrder.indexOf(a.element) - elementOrder.indexOf(b.element) ||
      b.rarity - a.rarity ||
      b.encoreId - a.encoreId,
  );
  const output = characters.map(({ encoreId, ...c }) => c);

  // 6. diff 摘要（與舊 generated 逐欄比對）
  const summary = [];
  const newIds = new Set(output.map((c) => c.id));
  for (const c of output) {
    const old = oldById.get(c.id);
    if (!old) continue; // 新角色已在 newChars 記錄
    const diffs = ['nameZh', 'nameZhCn', 'nameEn', 'nameJa', 'nameKo', 'element', 'rarity', 'avatar']
      .filter((k) => old[k] !== undefined && old[k] !== c[k])
      .map((k) => `${k}: ${old[k]} → ${c[k]}`);
    if (diffs.length) summary.push(`變更 ${c.nameZh}: ${diffs.join(', ')}`);
  }
  for (const old of oldGenerated) {
    if (!newIds.has(old.id)) summary.push(`移除 ${old.nameZh}（${old.id}）`);
  }
  for (const n of newChars) summary.push(`新角色 ${n}`);
  // 疑似新屬性警示（進 CI commit 訊息）：新發現的屬性 + 缺色碼的屬性
  for (const n of newElements) {
    summary.push(`⚠ 疑似新屬性 ${n} — 已自動吸納，請執行 node scripts/add-element.mjs 補色碼`);
  }
  for (const e of elementsOut) {
    if (!elementOverrides[e.name]?.color) {
      summary.push(`⚠ 屬性「${e.name}」色碼未設定（UI 暫以中性灰顯示）— node scripts/add-element.mjs`);
    }
  }

  writeFileSync(GENERATED_PATH, JSON.stringify(output, null, 2) + '\n');
  writeFileSync(ELEMENTS_GENERATED_PATH, JSON.stringify(elementsOut, null, 2) + '\n');
  writeFileSync(ID_MAP_PATH, JSON.stringify(idMap, null, 2) + '\n');

  console.log(`✅ 共 ${output.length} 位角色 + ${elementsOut.length} 屬性 → src/data/`);
  console.log(summary.length ? summary.map((s) => '  - ' + s).join('\n') : '  （資料無變更）');
}

main().catch((err) => {
  console.error('❌ 爬蟲失敗：', err);
  process.exit(1);
});

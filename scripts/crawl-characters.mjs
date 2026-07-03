// ============================================================
// crawl-characters.mjs — encore.moe 角色資料爬蟲（P3，只在 CI / 本機 node 執行）。
//
// 流程：
//   1. 抓 zh-Hant + en 兩份 roleList，以數字 Id join（拿中文名 + 英文名）。
//   2. id 對應採乙方案：scripts/id-map.json（encore 數字 Id → 我們的 kebab id）。
//      - 對照表沒有的 Id → 先用中文名比對現有 generated.json 認領舊 id；
//        再沒有 → 由英文名轉 kebab-case 自動生成，並在摘要標記【新角色】。
//      - 解析結果一律寫回 id-map.json 持久化。
//   3. schema 驗證：element 必屬六屬性、rarity ∈ {4,5}、名稱非空；任一筆失敗
//      → 整批中止不落檔（避免髒資料入庫）。
//   4. 下載頭像 → public/assets/characters/<id>.webp（已存在即跳過）。
//   5. 寫 src/data/characters.generated.json（屬性分組、5★ 在 4★ 前、組內依
//      encore Id 升冪 → 輸出穩定、git diff 乾淨）。
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

const ELEMENTS = ['氣動', '冷凝', '導電', '湮滅', '衍射', '熱熔'];
// 屬性中文名 → ASCII 檔名 slug（六屬性固定，對齊 encore 英文屬性名，供頭像檔名穩定）。
const ELEMENT_SLUG = {
  氣動: 'aero',
  冷凝: 'glacio',
  導電: 'electro',
  湮滅: 'havoc',
  衍射: 'spectro',
  熱熔: 'fusion',
};
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
  // 1. 抓兩種語言並以數字 Id join
  const [zhList, enList] = await Promise.all([
    fetchRoleList('zh-Hant'),
    fetchRoleList('en'),
  ]);
  const enById = new Map(enList.map((r) => [r.Id, r]));

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
      nameEn,
      element: zh.Element?.Name,
      rarity: zh.QualityId,
      encoreId: zh.Id, // 排序用，落檔前移除
    };

    // 3. schema 驗證（任一筆失敗 → 整批中止）
    if (!c.id || !c.nameZh) errors.push(`Id ${zh.Id}: 名稱/id 為空`);
    if (!ELEMENTS.includes(c.element)) errors.push(`${c.nameZh}: 未知屬性「${c.element}」`);
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

  // 屬性（元素）資料 + 圖示：從 roleList 收集 6 個不重複 Element，下載 icon，
  // 依 ELEMENTS 正典序產出（供角色選單頁籤顯示）。缺屬性或下載失敗計入 errors。
  const elemByName = new Map();
  for (const zh of zhList) {
    const e = zh.Element;
    if (e?.Name && !elemByName.has(e.Name)) elemByName.set(e.Name, e);
  }
  const oldElements = readJson(ELEMENTS_GENERATED_PATH, []);
  const elementsOut = [];
  for (const name of ELEMENTS) {
    const e = elemByName.get(name);
    if (!e) {
      errors.push(`屬性缺漏：${name}`);
      continue;
    }
    const slug = ELEMENT_SLUG[name];
    const iconPath = join(ELEMENT_DIR, `${slug}.webp`);
    const entry = { name, slug };
    if (!SKIP_AVATARS && e.Icon) {
      const ok = await downloadImage(`${RESOURCE_BASE}${e.Icon}.webp`, iconPath);
      if (!ok) errors.push(`屬性 ${name}: 圖示下載失敗`);
    }
    if (existsSync(iconPath)) entry.icon = `/assets/elements/${slug}.webp`;
    else {
      const oldE = oldElements.find((x) => x.name === name);
      if (oldE?.icon) entry.icon = oldE.icon; // skip 模式保留舊圖示欄位
    }
    elementsOut.push(entry);
  }

  if (errors.length > 0) {
    console.error('❌ schema 驗證失敗，整批中止：');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  // 5. 穩定排序：屬性順序 → 5★ 前 4★ 後 → encore Id 升冪
  characters.sort(
    (a, b) =>
      ELEMENTS.indexOf(a.element) - ELEMENTS.indexOf(b.element) ||
      b.rarity - a.rarity ||
      a.encoreId - b.encoreId,
  );
  const output = characters.map(({ encoreId, ...c }) => c);

  // 6. diff 摘要（與舊 generated 逐欄比對）
  const summary = [];
  const newIds = new Set(output.map((c) => c.id));
  for (const c of output) {
    const old = oldById.get(c.id);
    if (!old) continue; // 新角色已在 newChars 記錄
    const diffs = ['nameZh', 'nameEn', 'element', 'rarity', 'avatar']
      .filter((k) => old[k] !== undefined && old[k] !== c[k])
      .map((k) => `${k}: ${old[k]} → ${c[k]}`);
    if (diffs.length) summary.push(`變更 ${c.nameZh}: ${diffs.join(', ')}`);
  }
  for (const old of oldGenerated) {
    if (!newIds.has(old.id)) summary.push(`移除 ${old.nameZh}（${old.id}）`);
  }
  for (const n of newChars) summary.push(`新角色 ${n}`);

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

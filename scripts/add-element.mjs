// ============================================================
// add-element.mjs — 屬性資料人工補完 CLI（只在本機 node 執行）。
//
// 用途：遊戲新增屬性時，爬蟲會自動吸納名稱/slug/圖示，但「代表色」是
// 美術決策、API 沒有 → 用本腳本互動輸入，寫入 elements.overrides.json。
//
// 行為：
//   1. 印出完整屬性總覽表格（名稱 / slug / 色碼 / 圖示；缺漏顯示 ✗ 缺）。
//   2. 對缺色碼的屬性逐一提示輸入：
//      - 色碼：必填，#RRGGBB 格式，錯誤重問。
//      - 圖示連結：選填，留空沿用爬蟲下載的；有輸入則下載覆蓋本地圖檔。
//   3. 寫回 src/data/elements.overrides.json，重印更新後總覽。
//   全部齊全時 → 只印總覽即結束（可當純查看工具）。
//
// 用法：node scripts/add-element.mjs
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED_PATH = join(ROOT, 'src/data/elements.generated.json');
const OVERRIDES_PATH = join(ROOT, 'src/data/elements.overrides.json');
const ELEMENT_DIR = join(ROOT, 'public/assets/elements');

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// 中文全形字寬 2、半形寬 1 的簡易對齊（表格用）。
function padCell(text, width) {
  const s = String(text);
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return s + ' '.repeat(Math.max(0, width - w));
}

/** 印出屬性總覽表格：各欄有值顯示實際值，缺漏顯示 ✗ 缺。 */
function printTable(generated, overrides) {
  console.log('');
  console.log(
    padCell('屬性', 8) + padCell('slug', 12) + padCell('色碼', 12) + '圖示',
  );
  console.log('─'.repeat(56));
  for (const e of generated) {
    const color = overrides[e.name]?.color;
    const icon = overrides[e.name]?.icon ?? e.icon;
    console.log(
      padCell(e.name, 8) +
        padCell(e.slug, 12) +
        padCell(color ?? '✗ 缺', 12) +
        (icon ? `✓ ${icon}` : '✗ 缺'),
    );
  }
  console.log('');
}

async function downloadIcon(url, slug) {
  const destPath = join(ELEMENT_DIR, `${slug}.webp`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return `/assets/elements/${slug}.webp`;
}

async function main() {
  const generated = readJson(GENERATED_PATH, []);
  const overrides = readJson(OVERRIDES_PATH, {});

  if (generated.length === 0) {
    console.error('❌ 找不到 elements.generated.json，請先執行 node scripts/crawl-characters.mjs');
    process.exit(1);
  }

  printTable(generated, overrides);

  // 缺漏＝色碼未設定（圖示由爬蟲自動下載，通常不缺；缺圖示但有色碼者也一併列入詢問）
  const missing = generated.filter(
    (e) => !overrides[e.name]?.color || !(overrides[e.name]?.icon ?? e.icon),
  );
  if (missing.length === 0) {
    console.log('✅ 無缺漏，所有屬性欄位齊全。');
    return;
  }

  console.log(`共 ${missing.length} 個屬性有缺漏欄位，開始逐一補完（Ctrl+C 可隨時中止）：\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // EOF 防護：stdin 中途關閉（管線輸入耗盡/Ctrl+D）時，question 的 promise
  // 永不 resolve、node 會靜默以 0 退出且不寫檔 → 改為明確警告並以 1 中止。
  const EOF = Symbol('eof');
  let rlDone = false;
  const rlClosed = new Promise((resolve) => rl.once('close', () => resolve(EOF)));
  async function ask(prompt) {
    const answer = await Promise.race([rl.question(prompt), rlClosed]);
    if (answer === EOF && !rlDone) {
      console.error('\n⚠ 輸入中斷（EOF），未寫入任何變更。');
      process.exit(1);
    }
    return answer;
  }

  for (const e of missing) {
    console.log(`── 屬性「${e.name}」（slug: ${e.slug}）──`);
    const entry = { ...(overrides[e.name] ?? {}) };

    // 色碼：必填，格式錯誤重問
    if (!entry.color) {
      for (;;) {
        const input = (await ask('  色碼（#RRGGBB，必填）：')).trim();
        if (HEX_RE.test(input)) {
          entry.color = input.startsWith('#') ? `#${input.slice(1).toUpperCase()}` : input;
          break;
        }
        console.log('  ⚠ 格式錯誤，請輸入如 #55FFB5 的 6 位十六進位色碼。');
      }
    }

    // 圖示：選填。留空＝沿用爬蟲下載的（若有）；輸入 URL＝下載覆蓋本地圖檔。
    const hasIcon = !!(entry.icon ?? e.icon);
    const iconPrompt = hasIcon
      ? '  圖示連結（選填，留空沿用現有圖示）：'
      : '  圖示連結（目前無圖示；留空略過，之後可再補）：';
    const iconInput = (await ask(iconPrompt)).trim();
    if (iconInput) {
      try {
        entry.icon = await downloadIcon(iconInput, e.slug);
        console.log(`  ✓ 圖示已下載 → ${entry.icon}`);
      } catch (err) {
        console.log(`  ⚠ 圖示下載失敗（${err.message}），略過此欄位，之後可重跑補上。`);
      }
    }

    overrides[e.name] = entry;
    console.log('');
  }
  rlDone = true;
  rl.close();

  writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + '\n');
  console.log('✅ 已寫入 src/data/elements.overrides.json，更新後總覽：');
  printTable(generated, overrides);
  console.log('請記得 commit：src/data/elements.overrides.json（與新下載的圖示，如有）。');
}

main().catch((err) => {
  console.error('❌ 執行失敗：', err);
  process.exit(1);
});

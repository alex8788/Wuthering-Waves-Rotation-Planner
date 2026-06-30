// ============================================================
// useImageExport.ts
// 圖片匯出的底層工具：把 DOM 節點點陣化成 PNG，並存檔。
//
//   - nodeToPngBlob(node)：以高像素密度(pixelRatio)把節點轉成 PNG Blob,
//       放大不模糊。轉換前等字型載入完成,避免 foreignObject 缺字。
//   - saveBlob(blob, filename)：優先用 File System Access API 的原生
//       「另存新檔」對話框(可選資料夾+檔名);不支援時退回 <a download>。
//
// 多軸合併 / 分開(ZIP)的協調邏輯於階段四再加。
// ============================================================

import { toBlob } from 'html-to-image';

/** 匯出底色,比照 app 背景,避免透明 PNG 在淺色檢視器下看不清。 */
const EXPORT_BG = '#0A0F1E';

/** 像素密度:2~3 倍,放大檢視仍清晰。 */
const PIXEL_RATIO = 3;

/** 瀏覽器 canvas 單邊上限(Chrome 約 16384px)。超過會產生空白/壞圖。 */
const MAX_CANVAS_DIM = 16384;

/**
 * 把 DOM 節點點陣化成 PNG Blob。
 *
 * skipFonts:true —— 不嵌入遠端 web 字型。html-to-image 預設會去抓 Google Fonts
 * 的樣式表並內聯 @font-face,但該樣式表為跨來源(無 CORS),讀 cssRules 會丟
 * SecurityError 並卡住(且 Noto Sans TC 巨大,抓取/解析極慢)。改為跳過嵌入,
 * 由匯出視圖的字型 fallback 鏈(JetBrains Mono → Consolas / 系統黑體)在本機
 * 點陣化時自然命中,文字仍清楚,且不依賴匯出當下的網路。
 *
 * pixelRatio 依節點實際尺寸自動退讓:長連招會讓視圖很寬,width×3 可能超過
 * canvas 單邊上限而產生空白/壞圖 → 動態夾住倍率,確保不超界。
 */
export async function nodeToPngBlob(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready;

  const rect = node.getBoundingClientRect();
  const longest = Math.max(rect.width, rect.height) || 1;
  const safeRatio = Math.max(1, Math.min(PIXEL_RATIO, MAX_CANVAS_DIM / longest));

  const blob = await toBlob(node, {
    pixelRatio: safeRatio,
    backgroundColor: EXPORT_BG,
    cacheBust: true,
    skipFonts: true,
  });
  if (!blob || blob.size === 0) {
    throw new Error(`點陣化失敗:產出空白圖 (size=${blob?.size ?? 'null'})`);
  }
  return blob;
}

/** 瀏覽器是否支援原生另存對話框(File System Access API)。 */
function supportsFilePicker(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

interface SaveSpec {
  /** 副檔名(不含點),如 'png' / 'zip'。 */
  ext: string;
  /** MIME 類型,如 'image/png' / 'application/zip'。 */
  mime: string;
  /** File System Access API 的類型描述。 */
  description: string;
}

const PNG_SPEC: SaveSpec = { ext: 'png', mime: 'image/png', description: 'PNG 圖片' };
const ZIP_SPEC: SaveSpec = { ext: 'zip', mime: 'application/zip', description: 'ZIP 壓縮檔' };

/**
 * 退回方案:不支援原生另存的瀏覽器,用 <a download> 觸發一般下載
 * (僅自訂檔名,存到瀏覽器預設下載資料夾)。
 */
function downloadBlob(blob: Blob, suggestedName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  // 重點:不可在 click() 後立刻 revoke / 移除 —— 瀏覽器可能尚未開始讀取
  // blob 就被釋放,導致下載中斷、檔案毀損(0 byte / 截斷)。延後清理。
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10000);
}

/**
 * 存檔。filename 不含副檔名;依 spec 補上。
 * 回傳 true=已存檔,false=使用者取消原生對話框。
 *
 * 支援原生另存(Chrome / Edge 等一般瀏覽器)就跳原生對話框;否則退回一般下載。
 * 註:嵌入式瀏覽器(如 VS Code 內建 Simple Browser)的原生另存行為異常,
 *     請改用一般瀏覽器檢視 / 匯出。
 */
async function saveBlob(blob: Blob, filename: string, spec: SaveSpec): Promise<boolean> {
  const suggestedName = `${filename}.${spec.ext}`;

  if (supportsFilePicker()) {
    type PickerWindow = Window & {
      showSaveFilePicker: (opts: unknown) => Promise<{
        createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
      }>;
    };
    try {
      const handle = await (window as unknown as PickerWindow).showSaveFilePicker({
        suggestedName,
        types: [{ description: spec.description, accept: { [spec.mime]: [`.${spec.ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      // 使用者按取消 → AbortError → 視為取消。
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      throw err;
    }
  }

  downloadBlob(blob, suggestedName);
  return true;
}

/** 存 PNG。 */
export function savePng(blob: Blob, filename: string): Promise<boolean> {
  return saveBlob(blob, filename, PNG_SPEC);
}

/** 存 ZIP(階段四多軸分開用)。 */
export function saveZip(blob: Blob, filename: string): Promise<boolean> {
  return saveBlob(blob, filename, ZIP_SPEC);
}

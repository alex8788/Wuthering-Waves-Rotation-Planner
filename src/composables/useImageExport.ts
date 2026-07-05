// ============================================================
// useImageExport.ts — 圖片匯出底層：DOM 節點轉 PNG / SVG 並存檔。
//
//   - nodeToPngBlob：可調 pixelRatio 轉 PNG Blob（倍率越低檔案越小），轉換前等字型就緒。
//   - nodeToSvgBlob：轉向量 SVG Blob（文字/圖形不點陣化，通常檔案遠小於高倍 PNG）。
//   - savePng / saveSvg / saveZip：優先用 File System Access API 原生另存，不支援退回 <a download>。
// ============================================================

import { toBlob, toSvg } from 'html-to-image';

/** 匯出底色,比照 app 背景,避免透明圖在淺色檢視器下看不清。 */
const EXPORT_BG = '#0A0F1E';

/** 預設像素密度（未指定倍率時採用）。 */
export const DEFAULT_PIXEL_RATIO = 2;

/**
 * 可選 PNG 解析度倍率。倍率越高越清晰但檔案越大；PNG 過大時可調低。
 * 1×＝原生尺寸（最小檔），3×＝三倍超取樣（最清晰）。
 */
export const PNG_SCALE_OPTIONS = [1, 1.5, 2, 3] as const;

/** 瀏覽器 canvas 單邊上限(Chrome 約 16384px)。超過會產生空白/壞圖。 */
const MAX_CANVAS_DIM = 16384;

/**
 * 把 DOM 節點點陣化成 PNG Blob。
 * skipFonts:true —— 不嵌入遠端字型（跨來源讀 cssRules 會 SecurityError 卡住，
 *   且 Noto Sans TC 巨大）；改靠匯出視圖字型 fallback 鏈本機命中。
 * pixelRatio 依節點尺寸動態夾住，避免超過 canvas 單邊上限而產生壞圖。
 */
export async function nodeToPngBlob(
  node: HTMLElement,
  pixelRatio: number = DEFAULT_PIXEL_RATIO,
): Promise<Blob> {
  await document.fonts.ready;

  const rect = node.getBoundingClientRect();
  const longest = Math.max(rect.width, rect.height) || 1;
  const safeRatio = Math.max(1, Math.min(pixelRatio, MAX_CANVAS_DIM / longest));

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

/**
 * 把 DOM 節點轉成向量 SVG Blob。
 * 文字與向量圖形保持向量（縮放不失真、體積小）；內嵌的頭像等點陣圖仍以資料
 * URI 內嵌。與 PNG 同樣 skipFonts（靠本機 fallback 字型）並填入匯出底色。
 */
export async function nodeToSvgBlob(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready;

  const dataUrl = await toSvg(node, {
    backgroundColor: EXPORT_BG,
    cacheBust: true,
    skipFonts: true,
  });
  // toSvg 回傳 data:image/svg+xml 的 data URL；用 fetch 解回實際 SVG 文字成 Blob。
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error(`SVG 產生失敗:產出空白圖 (size=${blob?.size ?? 'null'})`);
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
const SVG_SPEC: SaveSpec = { ext: 'svg', mime: 'image/svg+xml', description: 'SVG 向量圖' };
const ZIP_SPEC: SaveSpec = { ext: 'zip', mime: 'application/zip', description: 'ZIP 壓縮檔' };

/** 退回方案：用 <a download> 觸發一般下載（存到瀏覽器預設下載資料夾）。 */
function downloadBlob(blob: Blob, suggestedName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  // 不可在 click() 後立刻 revoke/移除：瀏覽器可能尚未讀取 blob 就被釋放而毀損。延後清理。
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10000);
}

/**
 * 存檔（filename 不含副檔名，依 spec 補上）；回傳 true=已存、false=使用者取消。
 * 註：嵌入式瀏覽器（如 VS Code Simple Browser）原生另存行為異常，請用一般瀏覽器。
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

/** 存 SVG。 */
export function saveSvg(blob: Blob, filename: string): Promise<boolean> {
  return saveBlob(blob, filename, SVG_SPEC);
}

/** 存 ZIP(階段四多軸分開用)。 */
export function saveZip(blob: Blob, filename: string): Promise<boolean> {
  return saveBlob(blob, filename, ZIP_SPEC);
}

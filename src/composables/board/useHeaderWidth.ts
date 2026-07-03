// ============================================================
// useHeaderWidth.ts — 泳道 header 共用動態寬度。
//
// 三泳道 header 必須等寬才能與時間欄對齊；編輯面板（RotationBoard）與
// 匯出視圖（RotationExportView）也必須用「同一套寬度算法」才會一致，
// 否則匯出圖與畫面對不上、或名稱被截斷。
//
// 作法：用 canvas measureText 量「最長角色名」的像素寬，加上頭像/把手/
// 間距的固定基底，夾在 [MIN, MAX]。回傳 px 數值（computed）。
// ============================================================

import { computed, type ComputedRef } from 'vue';
import { useCharacterStore } from '@/stores/useCharacterStore';

// header 內名稱的實際字型（與 Swimlane / ExportView 的 .header__name 一致）。
const HEADER_NAME_FONT = '700 12px "Noto Sans TC", system-ui, sans-serif';
// 基底：左 padding + 拖曳把手 + 頭像 + 內外間距 + 右 padding 的總和（≈94px）。
const BASE_PX = 94;
const MIN_PX = 132;
const MAX_PX = 240;
// 占位字：全空時避免 header 過窄。
const PLACEHOLDER = '選擇角色';

let _measureCanvas: HTMLCanvasElement | null = null;
function measureTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') return text.length * 12;
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
  const ctx = _measureCanvas.getContext('2d');
  if (!ctx) return text.length * 12;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** 依三泳道最長角色名算出共用 header 寬度（px）。編輯面板與匯出視圖共用。 */
export function useHeaderWidth(): { headerWidthPx: ComputedRef<number> } {
  const characterStore = useCharacterStore();

  const headerWidthPx = computed<number>(() => {
    const candidates = characterStore.slotCharacters
      .map((c) => c?.nameZh)
      .filter((n): n is string => !!n);
    candidates.push(PLACEHOLDER);
    const maxName = candidates.reduce(
      (m, n) => Math.max(m, measureTextWidth(n, HEADER_NAME_FONT)),
      0,
    );
    return Math.round(Math.min(MAX_PX, Math.max(MIN_PX, BASE_PX + maxName)));
  });

  return { headerWidthPx };
}

// ============================================================
// reducedMotion.ts — 「減少動態效果」偏好偵測（單一來源）。
//
// 供 JS 端決定是否略過動畫（CSS 端另由 style.css 的 force-reduce-motion 全域規則
// 與各自 @media 查詢處理）。即時查詢而非模組載入時快取：系統設定或應用內
// 「動畫效果」開關中途切換皆能立即生效。
// ============================================================

import { useSettings } from '@/composables/state/useSettings';

/** 是否應減少動態效果：應用內動畫開關關閉，或系統偏好 reduced-motion。 */
export function prefersReducedMotion(): boolean {
  // 應用內總開關優先：關閉即強制減少動態，與系統設定無關。
  if (!useSettings().settings.value.animationsEnabled) return true;
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

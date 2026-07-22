// ============================================================
// useHotkeyMapDialog.ts — 熱鍵對映表編輯視窗的開合單例。
//
// 比照 useExportDialog：畫面由 HotkeyMapDialog.vue（掛在 App 根層的 Teleport）
// 渲染，本 composable 僅管開合狀態。無回傳值（編輯即時寫入 useHotkeyMap）。
// ============================================================

import { ref } from 'vue';

// 模組層級單例：視窗開合狀態。
const isOpen = ref(false);

export function useHotkeyMapDialog() {
  function open(): void {
    isOpen.value = true;
  }
  function close(): void {
    isOpen.value = false;
  }
  return { isOpen, open, close };
}

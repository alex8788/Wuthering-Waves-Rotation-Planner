// ============================================================
// useTeamManager.ts — 隊伍管理浮層的開合狀態（module 單例）。
//
// 比照 useExportDialog 的單例模式：畫面由 TeamManagerDialog.vue（掛在 App
// 根層的 Teleport）渲染，本 composable 僅管開/合。
// ============================================================

import { ref } from 'vue';

const isOpen = ref(false);
/** 開啟時是否直接進入「另存新檔」命名列（供 Ctrl+Shift+S 快捷鍵使用）。 */
const saveAsRequested = ref(false);

export function useTeamManager() {
  function open(): void {
    isOpen.value = true;
  }
  /** 開啟管理頁並要求直接進入另存命名（旗標由 TeamManagerDialog 消費後清除）。 */
  function openSaveAs(): void {
    saveAsRequested.value = true;
    isOpen.value = true;
  }
  function close(): void {
    isOpen.value = false;
    saveAsRequested.value = false;
  }
  return { isOpen, saveAsRequested, open, openSaveAs, close };
}

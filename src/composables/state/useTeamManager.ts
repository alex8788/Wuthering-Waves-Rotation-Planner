// ============================================================
// useTeamManager.ts — 隊伍管理浮層的開合狀態（module 單例）。
//
// 比照 useExportDialog 的單例模式：畫面由 TeamManagerDialog.vue（掛在 App
// 根層的 Teleport）渲染，本 composable 僅管開/合。
// ============================================================

import { ref } from 'vue';

const isOpen = ref(false);

export function useTeamManager() {
  function open(): void {
    isOpen.value = true;
  }
  function close(): void {
    isOpen.value = false;
  }
  return { isOpen, open, close };
}

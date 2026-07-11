// ============================================================
// useHelpDialog.ts — 使用手冊視窗開關（module 單例，仿 useTeamManager）。
// 目前僅承載「快捷鍵表」；日後擴充圖文教學亦沿用同一開關。
// ============================================================

import { ref } from 'vue';

const isOpen = ref(false);

export function useHelpDialog() {
  function open(): void {
    isOpen.value = true;
  }
  function close(): void {
    isOpen.value = false;
  }
  return { isOpen, open, close };
}

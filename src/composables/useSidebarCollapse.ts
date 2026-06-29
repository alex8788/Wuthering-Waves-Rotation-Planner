// ============================================================
// useSidebarCollapse.ts
// 側邊欄收合狀態（module 單例）。
//
// 收合狀態需同時被版面（AppLayout 渲染欄寬／切換鈕）與全域快捷鍵
// （useKeyboardShortcuts 的 Tab 切換）讀寫，故抽成模組層級單例 ref，
// 確保兩處共用同一份狀態。
// ============================================================

import { ref } from 'vue';

// 模組層級單例：整個 App 共用同一份收合狀態。
const collapsed = ref(false);

export function useSidebarCollapse() {
  function toggle(): void {
    collapsed.value = !collapsed.value;
  }

  return { collapsed, toggle };
}

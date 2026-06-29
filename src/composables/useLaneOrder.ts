// ============================================================
// useLaneOrder.ts
// 泳道「垂直顯示順序」（module 單例）。
//
// 只描述三條泳道在畫面上的上下排列順序，是一個 slotIndex 的排列
// （預設 [0, 1, 2]）。拖曳泳道僅改變此排列：
//   - 不動 rotationStore.entries（全域相對順序、各 entry 的 slotIndex 不變）
//   - 不動 characterStore.slots（角色歸屬不變）
//   - 不動欄位對齊（欄位用 entry 在全域陣列的 index 計算，與泳道順序無關）
// 故「受影響泳道的區塊」在拖曳過程資料零變動，只是 DOM 列順序改變。
//
// 不做持久化：未來「保存隊伍排軸」會以整個隊伍為單位連泳道順序一起存，
// 屆時再由該機制負責，這裡只保留 in-memory 狀態。
// ============================================================

import { ref } from 'vue';
import type { SlotIndex } from '@/types/character';

// 模組層級單例：整個 App 共用同一份泳道顯示順序。
const laneOrder = ref<SlotIndex[]>([0, 1, 2]);

export function useLaneOrder() {
  /**
   * setOrderByMove：把目前順序中位於 fromDisplayIndex 的泳道，移動到
   * toDisplayIndex（移除後再插入的最終位置語意）。
   */
  function setOrderByMove(fromDisplayIndex: number, toDisplayIndex: number): void {
    if (fromDisplayIndex === toDisplayIndex) return;
    const arr = [...laneOrder.value];
    if (fromDisplayIndex < 0 || fromDisplayIndex >= arr.length) return;
    const [moved] = arr.splice(fromDisplayIndex, 1);
    const clamped = Math.max(0, Math.min(toDisplayIndex, arr.length));
    arr.splice(clamped, 0, moved);
    laneOrder.value = arr;
  }

  return { laneOrder, setOrderByMove };
}

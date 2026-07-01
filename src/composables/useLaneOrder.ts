// ============================================================
// useLaneOrder.ts — 泳道垂直顯示順序（module 單例）。
//
// 設計原則：
//   - 只是 slotIndex 的排列（預設 [0,1,2]），描述三泳道畫面上下順序。
//   - 拖曳泳道只改此排列，完全不動 entries / slots / 欄位對齊 → 區塊資料零變動，
//     只是 DOM 列順序改變。
//   - 純 in-memory，不持久化。
// ============================================================

import { ref } from 'vue';
import type { SlotIndex } from '@/types/character';
import { useHistory } from '@/composables/useHistory';

// 模組層級單例：整個 App 共用同一份泳道顯示順序。
const laneOrder = ref<SlotIndex[]>([0, 1, 2]);

export function useLaneOrder() {
  /** 把顯示序 fromDisplayIndex 的泳道移到 toDisplayIndex（移除後插入的最終位置）。 */
  function setOrderByMove(fromDisplayIndex: number, toDisplayIndex: number): void {
    if (fromDisplayIndex === toDisplayIndex) return;
    const arr = [...laneOrder.value];
    if (fromDisplayIndex < 0 || fromDisplayIndex >= arr.length) return;
    useHistory().record();
    const [moved] = arr.splice(fromDisplayIndex, 1);
    const clamped = Math.max(0, Math.min(toDisplayIndex, arr.length));
    arr.splice(clamped, 0, moved);
    laneOrder.value = arr;
  }

  return { laneOrder, setOrderByMove };
}

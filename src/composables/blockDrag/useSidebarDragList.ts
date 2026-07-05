// ============================================================
// useSidebarDragList.ts — 側邊欄拖曳清單的共用樣板（重構 R3）。
//
// GeneralBlockField / CustomBlockField 共用的三件事收斂於此：
//   - dragOptions        ：SortableJS 側邊欄設定（clone 語意、禁排序）。
//   - cloneToPlaceholder ：拖出瞬間把側邊欄區塊偽裝成主軸 entry 形狀的暫時資料，
//                          id 用預生成的 pendingInstanceId（:key 全程穩定）。
//   - handleDragEnd      ：先還原本地緩衝（pull:'clone' 原清單不變），再走全域落地。
// 各元件的 handleDragStart 邏輯不同（單拖 vs 模板多選整組），保留在元件內。
// ============================================================

import { computed } from 'vue';
import { useBlockDrag } from '@/composables/useBlockDrag';
import type { GeneralBlock, TemplateBlock } from '@/types/block';

export function useSidebarDragList(options: {
  /** 拖曳結束時還原本地緩衝陣列（VueDraggable 綁的是可寫副本）。 */
  restore: () => void;
}) {
  const {
    getOrCreatePendingInstanceId,
    onSidebarDragStart,
    getSidebarSortableOptions,
    handleDragEnd: endDrag,
  } = useBlockDrag();

  const dragOptions = computed(() => getSidebarSortableOptions());

  // 拖去主軸時，把原始區塊包成「看起來像主軸 entry」的暫時資料，
  // 避免畫面在正式寫入 store 前因資料形狀不符而報錯。
  // id 用預生成的 pendingInstanceId：與之後正式寫入 store 的 InstanceBlock
  // 共用同一 id，:key 全程不變（SortableJS 追蹤的 DOM 不被 Vue 中途重建）。
  function cloneToPlaceholder(original: GeneralBlock | TemplateBlock) {
    return {
      id: getOrCreatePendingInstanceId(),
      slotIndex: 0,
      block: { ...original },
    };
  }

  // 拖曳結束：務必重置全域拖曳狀態（否則 isDragging 殘留 → 鬆手後仍顯示
  // 落點預覽，且下一次操作的落地會被汙染），並還原本地緩衝。
  function handleDragEnd(): void {
    options.restore();
    endDrag();
  }

  return { dragOptions, cloneToPlaceholder, handleDragEnd, onSidebarDragStart };
}

// ============================================================
// useClipboard.ts — 區塊剪貼簿：複製 / 剪下 / 貼上 / 向右複製。
//
// 設計原則：模組層級單例緩衝區（存 RotationEntry[]），讓所有元件共享同一份 →
//           跨元件 Ctrl+C→Ctrl+V 語意一致；排序走 O(N) 遍歷主軸。
// ============================================================

import { ref, readonly } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useBoardScroll } from '@/composables/board/useBoardScroll';
import { showToast } from '@/composables/state/useToast';
import { deepClone } from '@/utils/deepClone';
import { t } from '@/i18n';
import type { RotationEntry } from '@/types/rotation';

// 模組層級單例（非 composable 內部 ref），確保「單一剪貼簿」語意。
const _clipboardBuffer = ref<RotationEntry[]>([]);
const _hasContent = ref(false);

export function useClipboard() {
  const rotationStore = useRotationStore();
  const { scrollEntryIntoView } = useBoardScroll();

  /** 取得依主軸時間順序排列的選取區塊（O(N) 遍歷）。 */
  function _getSortedSelectedEntries(): RotationEntry[] {
    const { entries, selectedEntries } = rotationStore;
    const selectedIds = new Set(selectedEntries.map((e) => e.id));
    return entries.filter((e) => selectedIds.has(e.id));
  }

  /** 把選取的 entries 深拷貝成剪貼簿項目（與主軸完全解耦）。 */
  function _buildClipboardItems(): RotationEntry[] {
    return _getSortedSelectedEntries().map((entry) => deepClone(entry));
  }

  /** 複製選取到剪貼簿（不刪原區塊）；Ctrl+C。 */
  function copySelected(): void {
    if (rotationStore.selectedEntries.length === 0) return;

    _clipboardBuffer.value = _buildClipboardItems();
    _hasContent.value = _clipboardBuffer.value.length > 0;

    const n = _clipboardBuffer.value.length;
    if (n > 0) showToast(n === 1 ? t('toast.copied') : t('toast.copiedN', { n }), 'success');
  }

  /** 剪下選取（複製後刪除原區塊）；Ctrl+X。 */
  function cutSelected(): void {
    if (rotationStore.selectedEntries.length === 0) return;

    _clipboardBuffer.value = _buildClipboardItems();
    _hasContent.value = _clipboardBuffer.value.length > 0;
    rotationStore.deleteSelectedBlocks();
  }

  /** 把剪貼簿插入主軸（插在最後一個選取之後，無選取則追加末尾）；Ctrl+V。 */
  function paste(): void {
    if (_clipboardBuffer.value.length === 0) return;

    const { entries, selectedEntries } = rotationStore;
    let insertAfterIndex = entries.length - 1;

    if (selectedEntries.length > 0) {
      const sortedSelected = _getSortedSelectedEntries();
      const lastSelected = sortedSelected[sortedSelected.length - 1];
      const lastIdx = entries.findIndex((e) => e.id === lastSelected.id);
      if (lastIdx !== -1) insertAfterIndex = lastIdx;
    }

    // 每次貼上都從剪貼簿重新深拷貝，允許多次連續貼上（insertClonedBlocks 賦予新 UUID）。
    const itemsToInsert = _clipboardBuffer.value.map((entry) => deepClone(entry));
    const newIds = rotationStore.insertClonedBlocks(itemsToInsert, insertAfterIndex);
    // 貼上位置可能在可視範圍外 → 渲染後捲動到最後一個貼上的區塊。
    scrollEntryIntoView(newIds[newIds.length - 1]);
  }

  /** 向右複製選取，插在原位置之後；Ctrl+D。 */
  function duplicateRight(): void {
    if (rotationStore.selectedEntries.length === 0) return;

    const { entries } = rotationStore;
    const sortedSelected = _getSortedSelectedEntries();

    // 插入點＝最後一個選取區塊的全域索引。
    const lastEntry = sortedSelected[sortedSelected.length - 1];
    const insertAfterIndex = entries.findIndex((e) => e.id === lastEntry.id);

    const itemsToInsert = sortedSelected.map((entry) => deepClone(entry));
    rotationStore.insertClonedBlocks(itemsToInsert, insertAfterIndex);
  }

  return {
    clipboardBuffer: readonly(_clipboardBuffer),
    hasContent: readonly(_hasContent),
    copySelected,
    cutSelected,
    paste,
    duplicateRight,
  };
}
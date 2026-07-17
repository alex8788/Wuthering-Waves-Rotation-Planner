// ============================================================
// useColumnMeasure.ts — 主軸共用 grid 欄寬量測（重構 R5）。
//
// 職責：隱藏量測列（渲染所有 entries 的 BlockChip）→ 讀各 chip 實寬 →
// 得出三泳道共用的 grid-template-columns。entries / 編輯草稿變動、
// 視窗縮放、字型載入完成時自動重量。
// 供 RotationBoard 使用；量測列 DOM 仍由元件渲染（綁 measurerRef）。
// ============================================================

import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useSettings } from '@/composables/state/useSettings';

// measurerRef 由元件建立並傳入：元件內以頂層 const ref 綁定 string template ref，
// 才能被 vue-tsc 認定為「已使用」（避免 noUnusedLocals 誤報 TS6133）。
export function useColumnMeasure(measurerRef: Ref<HTMLElement | null> = ref(null)) {
  const rotationStore = useRotationStore();

  /** 各全域欄位寬度（px），index 對應 1D entries index。 */
  const columnWidths = ref<number[]>([]);

  /** 三泳道共用的 grid-template-columns（靜止版，無落點空欄）。 */
  const gridTemplate = computed<string>(() =>
    columnWidths.value.map((w) => `${w}px`).join(' '),
  );

  function measure(): void {
    const el = measurerRef.value;
    if (!el) return;
    columnWidths.value = Array.from(el.children).map(
      (child) => (child as HTMLElement).getBoundingClientRect().width,
    );
  }

  async function remeasureAfterRender(): Promise<void> {
    await nextTick();
    measure();
  }

  watch(() => rotationStore.entries, remeasureAfterRender, { deep: true });
  // 行內編輯草稿變動時也重新量測，讓編輯中的區塊即時變寬
  watch(() => rotationStore.editingDraft, remeasureAfterRender);
  // 區塊文字邊距設定變動時重量：--chip-px-setting 由 useSettings 的 watcher
  // 同步寫入 <html>，nextTick 後讀到的即是新內距下的 chip 實寬。
  const { settings } = useSettings();
  watch(() => settings.value.chipPaddingPx, remeasureAfterRender);

  function handleResize(): void {
    void remeasureAfterRender();
  }

  onMounted(async () => {
    await remeasureAfterRender();
    // 字型載入完成後字寬可能改變 → 再量一次
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => void remeasureAfterRender());
    }
    window.addEventListener('resize', handleResize);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize);
  });

  return { measurerRef, columnWidths, gridTemplate, remeasureAfterRender };
}

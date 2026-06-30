// ============================================================
// useExportDialog.ts
// 匯出設定視窗的全域單例狀態（比照 useDialog / useToast 單例模式）。
//
// 既有 useDialog 只支援單行 confirm / prompt，容不下「選軸 + 合併/分開 +
// 檔名」的表單，故另開此單例。畫面由 ExportDialog.vue（掛在 App 根層的
// Teleport）渲染：表單狀態由該元件自持，本 composable 僅管開合與 Promise。
//
//   - open() → Promise<ExportOptions | null>
//       確定 → 回傳使用者選定的選項；取消 / 點遮罩 → 回傳 null。
//   - submit(options) / cancel()：由 ExportDialog.vue 於確定 / 取消時呼叫。
// ============================================================

import { ref } from 'vue';

/** 多軸交付方式：合併成一張圖 / 分開打包成 ZIP（單軸時無意義）。 */
export type ExportMode = 'merge' | 'separate';

export interface ExportOptions {
  /** 檔名（不含副檔名）。 */
  filename: string;
  /** 要匯出的輸出軸 id 清單（至少一個）。 */
  axisIds: string[];
  /** 多軸時的交付方式。 */
  mode: ExportMode;
}

interface ExportDialogState {
  open: boolean;
  _resolve: ((value: ExportOptions | null) => void) | null;
}

const state = ref<ExportDialogState>({
  open: false,
  _resolve: null,
});

export function useExportDialog() {
  function open(): Promise<ExportOptions | null> {
    return new Promise<ExportOptions | null>((resolve) => {
      state.value = { open: true, _resolve: resolve };
    });
  }

  function _close(result: ExportOptions | null): void {
    const resolve = state.value._resolve;
    state.value = { open: false, _resolve: null };
    if (resolve) resolve(result);
  }

  /** 確定：回傳組好的匯出選項。 */
  function submit(options: ExportOptions): void {
    _close(options);
  }

  /** 取消：回傳 null。 */
  function cancel(): void {
    _close(null);
  }

  return { state, open, submit, cancel };
}

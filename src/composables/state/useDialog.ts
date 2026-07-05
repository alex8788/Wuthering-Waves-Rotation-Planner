// ============================================================
// useDialog.ts
// 全域對話框（module 單例，比照 useToast / useHistory 的單例模式）。
//
// 提供 Promise 化的 confirm / prompt：呼叫端 await 結果即可，畫面由
// DialogHost.vue（掛在 App 根層的 Teleport）統一渲染。同時只存在一個對話框。
//   - confirm(...) → Promise<boolean>（確定 true / 取消 false）
//   - prompt(...)  → Promise<string | null>（確定回傳輸入值 / 取消回傳 null）
// ============================================================

import { ref } from 'vue';
import { t } from '@/i18n';

type DialogKind = 'confirm' | 'prompt';

interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** 危險操作（如刪除）時把確定鈕標成紅色。 */
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
}

interface DialogState {
  open: boolean;
  kind: DialogKind;
  title: string;
  message: string;
  inputValue: string;
  placeholder: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  _resolve: ((value: boolean | string | null) => void) | null;
}

const state = ref<DialogState>({
  open: false,
  kind: 'confirm',
  title: '',
  message: '',
  inputValue: '',
  placeholder: '',
  confirmText: '確定',
  cancelText: '取消',
  danger: false,
  _resolve: null,
});

export function useDialog() {
  function confirm(opts: ConfirmOptions = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      state.value = {
        open: true,
        kind: 'confirm',
        title: opts.title ?? '',
        message: opts.message ?? '',
        inputValue: '',
        placeholder: '',
        confirmText: opts.confirmText ?? t('dialog.ok'),
        cancelText: opts.cancelText ?? t('dialog.cancel'),
        danger: opts.danger ?? false,
        _resolve: resolve as (v: boolean | string | null) => void,
      };
    });
  }

  function prompt(opts: PromptOptions = {}): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      state.value = {
        open: true,
        kind: 'prompt',
        title: opts.title ?? '',
        message: opts.message ?? '',
        inputValue: opts.defaultValue ?? '',
        placeholder: opts.placeholder ?? '',
        confirmText: opts.confirmText ?? t('dialog.ok'),
        cancelText: opts.cancelText ?? t('dialog.cancel'),
        danger: opts.danger ?? false,
        _resolve: resolve as (v: boolean | string | null) => void,
      };
    });
  }

  function _close(result: boolean | string | null): void {
    const resolve = state.value._resolve;
    state.value = { ...state.value, open: false, _resolve: null };
    if (resolve) resolve(result);
  }

  /** 確定：prompt 回傳目前輸入值，confirm 回傳 true。 */
  function handleConfirm(): void {
    if (state.value.kind === 'prompt') _close(state.value.inputValue);
    else _close(true);
  }

  /** 取消：prompt 回傳 null，confirm 回傳 false。 */
  function handleCancel(): void {
    if (state.value.kind === 'prompt') _close(null);
    else _close(false);
  }

  return { state, confirm, prompt, handleConfirm, handleCancel };
}

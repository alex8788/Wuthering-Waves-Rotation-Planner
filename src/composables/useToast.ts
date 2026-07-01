// ============================================================
// useToast.ts — 全域輕量提示框狀態（module 單例）。
//
// 設計原則：模組層級單例，讓所有元件（含純 .ts 檔）共享同一份狀態；
//           showToast 可在任意 .ts 直接 import 呼叫。
// ============================================================

import { reactive, readonly } from 'vue'

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

interface ToastState {
  visible: boolean
  message: string
  variant: ToastVariant
}

const _state = reactive<ToastState>({
  visible: false,
  message: '',
  variant: 'info',
})

let _dismissTimer: ReturnType<typeof setTimeout> | null = null

/** 顯示 Toast；duration 為自動消失毫秒數（預設 2800）。 */
export function showToast(
  message: string,
  variant: ToastVariant = 'info',
  duration = 2800,
): void {
  // 先清掉上一個計時器（防止閃爍）
  if (_dismissTimer !== null) {
    clearTimeout(_dismissTimer)
    _dismissTimer = null
  }

  _state.message = message
  _state.variant = variant
  _state.visible = true

  _dismissTimer = setTimeout(() => {
    _state.visible = false
    _dismissTimer = null
  }, duration)
}

/** 立即隱藏 Toast。 */
export function hideToast(): void {
  if (_dismissTimer !== null) {
    clearTimeout(_dismissTimer)
    _dismissTimer = null
  }
  _state.visible = false
}

/** 供 Vue 元件使用的介面；ToastNotification.vue 透過 toastState 訂閱（唯讀）。 */
export function useToast() {
  return {
    toastState: readonly(_state),
    showToast,
    hideToast,
  }
}

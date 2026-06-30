<script setup lang="ts">
// ============================================================
// DialogHost.vue
// 全域對話框宿主。掛載於 App.vue 頂層，透過 Teleport 渲染至 <body>
// （脫離任何 overflow / transform 限制，z-index 安全）。
//
// 狀態來源：useDialog() 單例。本元件為純呈現層：
//   - confirm：標題 + 訊息 + 取消/確定
//   - prompt：額外含一個自動聚焦的輸入框（Enter 確定 / Esc 取消）
//   - 點擊遮罩 = 取消
// ============================================================

import { nextTick, ref, watch } from 'vue'
import { useDialog } from '@/composables/useDialog'

const { state, handleConfirm, handleCancel } = useDialog()

const inputRef = ref<HTMLInputElement | null>(null)

// 開啟且為 prompt 時，下一個 tick 自動聚焦並選取輸入框內容。
watch(
  () => state.value.open,
  (open) => {
    if (open && state.value.kind === 'prompt') {
      void nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    }
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" :duration="200">
      <div
        v-if="state.open"
        class="dialog-overlay"
        @click.self="handleCancel"
      >
        <div
          class="dialog"
          role="dialog"
          aria-modal="true"
          @keydown.esc.prevent="handleCancel"
        >
          <h2 v-if="state.title" class="dialog__title">{{ state.title }}</h2>
          <p v-if="state.message" class="dialog__message">{{ state.message }}</p>

          <input
            v-if="state.kind === 'prompt'"
            ref="inputRef"
            v-model="state.inputValue"
            class="dialog__input"
            type="text"
            :placeholder="state.placeholder"
            @keydown.enter.prevent="handleConfirm"
          />

          <div class="dialog__actions">
            <button type="button" class="dialog__btn dialog__btn--cancel" @click="handleCancel">
              {{ state.cancelText }}
            </button>
            <button
              type="button"
              class="dialog__btn dialog__btn--confirm"
              :class="{ 'dialog__btn--danger': state.danger }"
              @click="handleConfirm"
            >
              {{ state.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(5, 8, 16, 0.62);
  backdrop-filter: blur(2px);
  opacity: 1;
}

.dialog {
  min-width: 280px;
  max-width: 420px;
  padding: 1.125rem 1.25rem 1rem;
  background-color: #0D1526;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 6px;
  clip-path: polygon(
    0 0, 100% 0, 100% calc(100% - 10px),
    calc(100% - 10px) 100%, 0 100%
  );
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

.dialog__title {
  margin: 0 0 0.5rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: rgba(34, 211, 238, 0.95);
  letter-spacing: 0.02em;
}

.dialog__message {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: rgba(240, 244, 248, 0.82);
}

.dialog__input {
  width: 100%;
  margin-top: 0.875rem;
  padding: 0.5rem 0.625rem;
  background-color: #0A0F1E;
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 4px;
  color: rgba(240, 244, 248, 0.95);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
}

.dialog__input:focus {
  border-color: rgba(34, 211, 238, 0.7);
}

.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.125rem;
}

.dialog__btn {
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background-color: #131b2e;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.8125rem;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.dialog__btn:hover {
  background-color: #1b2740;
  color: rgba(255, 255, 255, 0.92);
}

.dialog__btn--confirm {
  border-color: rgba(34, 211, 238, 0.45);
  color: rgba(34, 211, 238, 0.95);
}

.dialog__btn--confirm:hover {
  background-color: rgba(34, 211, 238, 0.14);
}

.dialog__btn--danger {
  border-color: rgba(248, 113, 113, 0.5);
  color: rgba(248, 113, 113, 0.95);
}

.dialog__btn--danger:hover {
  background-color: rgba(248, 113, 113, 0.16);
}

.dialog__btn:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.6);
  outline-offset: 1px;
}

.dialog-enter-active {
  transition: opacity 0.18s ease;
}
.dialog-leave-active {
  transition: opacity 0.14s ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-active .dialog {
  transition: transform 0.2s cubic-bezier(0.34, 1.26, 0.64, 1);
}
.dialog-enter-from .dialog {
  transform: translateY(10px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active,
  .dialog-leave-active,
  .dialog-enter-active .dialog {
    transition: opacity 0.12s ease;
  }
  .dialog-enter-from .dialog {
    transform: none;
  }
}
</style>

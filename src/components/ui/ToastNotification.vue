<script setup lang="ts">
// ============================================================
// ToastNotification.vue
// 全局輕量提示框。掛載於 App.vue 頂層，透過 Teleport 渲染至
// <body>，確保永遠位於所有層級之上（z-index 安全）。
//
// 狀態來源：useToast() composable（Singleton）。
// 此元件本身為無狀態的純呈現層，所有顯示邏輯由 composable 控制。
// ============================================================

import { useToast } from '@/composables/state/useToast'

const { toastState, hideToast } = useToast()

// ── 每種 variant 對應的視覺 token ───────────────────────────
const variantConfig = {
  info:    { indicatorClass: 'indicator--info',    icon: '◈' },
  success: { indicatorClass: 'indicator--success', icon: '✓' },
  warning: { indicatorClass: 'indicator--warning', icon: '⚠' },
  danger:  { indicatorClass: 'indicator--danger',  icon: '✕' },
} as const
</script>

<template>
  <!-- Teleport 確保脫離任何父元素的 overflow / transform 限制 -->
  <Teleport to="body">
    <Transition name="toast">
      <div
        v-if="toastState.visible"
        class="toast"
        :class="`toast--${toastState.variant}`"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <!-- 左側發光指示條 -->
        <div
          class="toast__indicator"
          :class="variantConfig[toastState.variant].indicatorClass"
          aria-hidden="true"
        />

        <!-- 圖示 -->
        <span class="toast__icon" aria-hidden="true">
          {{ variantConfig[toastState.variant].icon }}
        </span>

        <!-- 訊息文字 -->
        <p class="toast__message">{{ toastState.message }}</p>

        <!-- 手動關閉按鈕 -->
        <button
          class="toast__close"
          :aria-label="$t('toast.closeLabel')"
          @click="hideToast"
        >
          ✕
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── 版面定位（固定在視窗右下角） ──────────────────────────── */
.toast {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 9999;

  /* ── 尺寸與排版 ─── */
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 220px;
  max-width: 380px;
  padding: 0.75rem 0.875rem 0.75rem 0;

  /* ── 視覺：科幻面板風格 ─── */
  background-color: #0D1526;          /* 深藍黑底 */
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 4px;
  /* 右下角切角，模擬 HUD 介面 */
  clip-path: polygon(
    0 0, 100% 0, 100% calc(100% - 8px),
    calc(100% - 8px) 100%, 0 100%
  );
  box-shadow:
    0  8px 32px rgba(0, 0, 0, 0.55),
    0  2px  8px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);

  /* ── 字型 ─── */
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

/* ── 左側指示條 ─────────────────────────────────────────────── */
.toast__indicator {
  flex-shrink: 0;
  width: 3px;
  align-self: stretch;
  border-radius: 0 2px 2px 0;
}

.indicator--info    { background: #22D3EE; box-shadow: 0 0 6px rgba(34,  211, 238, 0.7); }
.indicator--success { background: #34D399; box-shadow: 0 0 6px rgba(52,  211, 153, 0.7); }
.indicator--warning { background: #F5A623; box-shadow: 0 0 6px rgba(245, 166,  35, 0.7); }
.indicator--danger  { background: #EF4444; box-shadow: 0 0 6px rgba(239,  68,  68, 0.7); }

/* ── 圖示 ───────────────────────────────────────────────────── */
.toast__icon {
  flex-shrink: 0;
  font-size: 0.75rem;
  line-height: 1;
  padding-left: 0.625rem;
}

.toast--info    .toast__icon { color: #22D3EE; }
.toast--success .toast__icon { color: #34D399; }
.toast--warning .toast__icon { color: #F5A623; }
.toast--danger  .toast__icon { color: #EF4444; }

/* ── 訊息文字 ───────────────────────────────────────────────── */
.toast__message {
  flex: 1;
  margin: 0;
  font-size: 0.8125rem;  /* 13px */
  font-weight: 500;
  color: rgba(240, 244, 248, 0.90);
  letter-spacing: 0.02em;
  line-height: 1.4;
}

/* ── 關閉按鈕 ───────────────────────────────────────────────── */
.toast__close {
  flex-shrink: 0;
  padding: 0.125rem 0.375rem;
  margin-right: 0.25rem;
  font-size: 0.625rem;
  color: rgba(255, 255, 255, 0.35);
  background: transparent;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  line-height: 1;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.toast__close:hover {
  color: rgba(255, 255, 255, 0.80);
  background-color: rgba(255, 255, 255, 0.08);
}

.toast__close:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.60);
  outline-offset: 1px;
}

/* ── Vue Transition：淡入浮起 / 淡出上移 ───────────────────── */
.toast-enter-active {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.34, 1.26, 0.64, 1);
}
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(14px) scale(0.97);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

/* ── 無障礙：減少動畫模式 ──────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity 0.15s ease;
  }
  .toast-enter-from,
  .toast-leave-to {
    transform: none;
  }
}
</style>

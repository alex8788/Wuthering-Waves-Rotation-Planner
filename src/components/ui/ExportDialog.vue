<script setup lang="ts">
// ============================================================
// ExportDialog.vue
// 匯出設定視窗。掛載於 App.vue 頂層，透過 Teleport 渲染至 <body>。
//
// 狀態來源：useExportDialog() 單例（open）+ 本元件自持的表單狀態
// （檔名、勾選的軸、合併/分開）。確定時組出 ExportOptions 回傳，
// 取消 / 點遮罩 / Esc 回傳 null。
//
// 視覺沿用 DialogHost.vue 的暗色 / 發光 / clip-path 樣式慣例。
// ============================================================

import { ref, watch } from 'vue'
import { useExportDialog, type ExportMode, type ExportFormat } from '@/composables/state/useExportDialog'
import { useRotationStore } from '@/stores/useRotationStore'
import { useSettings } from '@/composables/state/useSettings'
import { PNG_SCALE_OPTIONS, DEFAULT_PIXEL_RATIO } from '@/composables/useImageExport'

const { state, submit, cancel } = useExportDialog()
const rotationStore = useRotationStore()
const { settings } = useSettings()

// ── 表單狀態 ────────────────────────────────────────────────
const filename = ref('')
const selectedIds = ref<Set<string>>(new Set())
const mode = ref<ExportMode>('merge')
const format = ref<ExportFormat>('png')
const scale = ref<number>(DEFAULT_PIXEL_RATIO)
const scaleOptions = PNG_SCALE_OPTIONS

// 視窗開啟時的預設：一律僅勾選作用中軸（軸 id 不跨 session 持久化，避免懸空）。
// 「記住匯出設定」開啟時，檔名/合併模式沿用上次；否則回預設（檔名＝軸名、合併）。
watch(
  () => state.value.open,
  (open) => {
    if (!open) return
    const active = rotationStore.activeAxis
    selectedIds.value = new Set([active.id])
    if (settings.value.rememberExport) {
      const prefs = settings.value.exportPrefs
      filename.value = prefs.filename || active.name
      mode.value = prefs.mode
      format.value = prefs.format
      scale.value = prefs.scale
    } else {
      filename.value = active.name
      mode.value = 'merge'
      format.value = 'png'
      scale.value = DEFAULT_PIXEL_RATIO
    }
  }
)

// 「記住匯出設定」開啟時，檔名/模式/格式/倍率每次調整即寫回設定（→ 持久化到 localStorage）。
watch([filename, mode, format, scale], () => {
  if (!state.value.open || !settings.value.rememberExport) return
  settings.value.exportPrefs = {
    filename: filename.value,
    mode: mode.value,
    format: format.value,
    scale: scale.value,
  }
})

function toggleAxis(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

// 確定可用條件：至少勾一個軸、檔名非空白。
const canConfirm = () =>
  selectedIds.value.size > 0 && filename.value.trim() !== ''

function handleConfirm(): void {
  if (!canConfirm()) return
  // 依 axes 原順序輸出，避免依勾選順序而錯亂。
  const axisIds = rotationStore.axes
    .filter((a) => selectedIds.value.has(a.id))
    .map((a) => a.id)
  submit({
    filename: filename.value.trim(),
    axisIds,
    mode: axisIds.length > 1 ? mode.value : 'merge',
    format: format.value,
    scale: scale.value,
  })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="export-dialog" :duration="200">
      <div
        v-if="state.open"
        class="export-overlay"
        @click.self="cancel"
      >
        <div
          class="export-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="$t('export.dialogLabel')"
          @keydown.esc.prevent="cancel"
        >
          <h2 class="export-dialog__title">{{ $t('export.title') }}</h2>

          <!-- 檔名 -->
          <label class="export-dialog__field">
            <span class="export-dialog__label">{{ $t('export.filename') }}</span>
            <input
              v-model="filename"
              class="export-dialog__input"
              type="text"
              :placeholder="$t('export.filenamePlaceholder')"
              @keydown.enter.prevent="handleConfirm"
            />
          </label>

          <!-- 檔案格式 -->
          <div class="export-dialog__field">
            <span class="export-dialog__label">{{ $t('export.format') }}</span>
            <div class="export-dialog__modes">
              <label class="export-dialog__mode">
                <input type="radio" value="png" v-model="format" />
                <span>{{ $t('export.formatPng') }}</span>
              </label>
              <label class="export-dialog__mode">
                <input type="radio" value="svg" v-model="format" />
                <span>{{ $t('export.formatSvg') }}</span>
              </label>
            </div>
          </div>

          <!-- 解析度倍率（僅 PNG） -->
          <div v-if="format === 'png'" class="export-dialog__field">
            <span class="export-dialog__label">{{ $t('export.resolution') }}</span>
            <div class="export-dialog__modes export-dialog__modes--row">
              <label
                v-for="opt in scaleOptions"
                :key="opt"
                class="export-dialog__mode"
              >
                <input type="radio" :value="opt" v-model="scale" />
                <span>{{ opt }}×</span>
              </label>
            </div>
            <span class="export-dialog__hint">{{ $t('export.resolutionHint') }}</span>
          </div>

          <!-- 選軸 -->
          <div class="export-dialog__field">
            <span class="export-dialog__label">{{ $t('export.axes') }}</span>
            <ul class="export-dialog__axes">
              <li v-for="axis in rotationStore.axes" :key="axis.id">
                <label class="export-dialog__axis">
                  <input
                    type="checkbox"
                    :checked="selectedIds.has(axis.id)"
                    @change="toggleAxis(axis.id)"
                  />
                  <span class="export-dialog__axis-name">{{ axis.name }}</span>
                </label>
              </li>
            </ul>
          </div>

          <!-- 合併 / 分開（多軸才顯示） -->
          <div v-if="selectedIds.size > 1" class="export-dialog__field">
            <span class="export-dialog__label">{{ $t('export.multiMode') }}</span>
            <div class="export-dialog__modes">
              <label class="export-dialog__mode">
                <input type="radio" value="merge" v-model="mode" />
                <span>{{ $t('export.merge') }}</span>
              </label>
              <label class="export-dialog__mode">
                <input type="radio" value="separate" v-model="mode" />
                <span>{{ $t('export.zip') }}</span>
              </label>
            </div>
          </div>

          <div class="export-dialog__actions">
            <button type="button" class="export-dialog__btn export-dialog__btn--cancel" @click="cancel">
              {{ $t('dialog.cancel') }}
            </button>
            <button
              type="button"
              class="export-dialog__btn export-dialog__btn--confirm"
              :disabled="!canConfirm()"
              @click="handleConfirm"
            >
              {{ $t('export.action') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.export-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  /* 頂端對齊（非置中）：切換 PNG/SVG 使內容高度變動時，上緣與寬度不位移，
     只往下伸長；超出視窗時由對話框自身內部捲動。 */
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 1rem 1rem;
  background-color: rgba(5, 8, 16, 0.62);
  backdrop-filter: blur(2px);
  opacity: 1;
}

.export-dialog {
  /* 固定寬度（不再隨內容在 320~440 間浮動）；窄視窗才退讓。 */
  width: 400px;
  max-width: 100%;
  /* 內容過高時夾住高度並內部捲動，避免底部超出視窗。 */
  max-height: calc(100vh - 8vh - 2rem);
  overflow-y: auto;
  overscroll-behavior: contain;
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
  scrollbar-width: thin;
  scrollbar-color: rgba(34, 211, 238, 0.25) transparent;
}

.export-dialog::-webkit-scrollbar {
  width: 6px;
}
.export-dialog::-webkit-scrollbar-thumb {
  background-color: rgba(34, 211, 238, 0.25);
  border-radius: 3px;
}

.export-dialog__title {
  margin: 0 0 0.875rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: rgba(34, 211, 238, 0.95);
  letter-spacing: 0.02em;
}

.export-dialog__field {
  display: block;
  margin-bottom: 0.875rem;
}

.export-dialog__label {
  display: block;
  margin-bottom: 0.375rem;
  font-size: 0.75rem;
  color: rgba(240, 244, 248, 0.55);
  letter-spacing: 0.02em;
}

.export-dialog__input {
  width: 100%;
  padding: 0.5rem 0.625rem;
  background-color: #0A0F1E;
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 4px;
  color: rgba(240, 244, 248, 0.95);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
}

.export-dialog__input:focus {
  border-color: rgba(34, 211, 238, 0.7);
}

.export-dialog__axes {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 9rem;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
}

.export-dialog__axis {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  font-size: 0.8125rem;
  color: rgba(240, 244, 248, 0.82);
  cursor: pointer;
}

.export-dialog__axis:hover {
  background-color: rgba(255, 255, 255, 0.04);
}

.export-dialog__axis-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-dialog__modes {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* 倍率選項橫向排列（1× 1.5× 2× 3×）。 */
.export-dialog__modes--row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.export-dialog__hint {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.6875rem;
  color: rgba(240, 244, 248, 0.42);
  letter-spacing: 0.02em;
}

.export-dialog__mode {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: rgba(240, 244, 248, 0.82);
  cursor: pointer;
}

.export-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.125rem;
}

.export-dialog__btn {
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

.export-dialog__btn:hover {
  background-color: #1b2740;
  color: rgba(255, 255, 255, 0.92);
}

.export-dialog__btn--confirm {
  border-color: rgba(34, 211, 238, 0.45);
  color: rgba(34, 211, 238, 0.95);
}

.export-dialog__btn--confirm:hover {
  background-color: rgba(34, 211, 238, 0.14);
}

.export-dialog__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.export-dialog__btn:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.6);
  outline-offset: 1px;
}

.export-dialog-enter-active {
  transition: opacity 0.18s ease;
}
.export-dialog-leave-active {
  transition: opacity 0.14s ease;
}
.export-dialog-enter-from,
.export-dialog-leave-to {
  opacity: 0;
}
.export-dialog-enter-active .export-dialog {
  transition: transform 0.2s cubic-bezier(0.34, 1.26, 0.64, 1);
}
.export-dialog-enter-from .export-dialog {
  transform: translateY(10px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .export-dialog-enter-active,
  .export-dialog-leave-active,
  .export-dialog-enter-active .export-dialog {
    transition: opacity 0.12s ease;
  }
  .export-dialog-enter-from .export-dialog {
    transform: none;
  }
}
</style>

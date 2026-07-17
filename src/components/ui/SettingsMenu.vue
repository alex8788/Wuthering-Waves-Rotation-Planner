<script setup lang="ts">
// ============================================================
// SettingsMenu.vue — 標題列齒輪按鈕 + 設定下拉面板。
//
// 設定項：
//   - 語言切換（5 語言，選項顯示各語言母語名；同步 i18n locale）
//   - 大寫鎖定（區塊文字提交時自動轉大寫）
//   - 動畫效果 / 復原步數 / 區塊間距 / 記住匯出設定
//   - 清除資料（還原通用區塊/匯出設定 + 刪除自訂模板/隊伍存檔；紅色警示鈕 + danger confirm）
//
// 自含觸發鈕與面板：外點/Escape 關閉；面板為 absolute 錨定於鈕右下。
// ============================================================

import { ref, onMounted, onUnmounted } from 'vue'
import {
  useSettings,
  resetExportSettings,
  clampSetting,
  HISTORY_LIMIT_BOUNDS,
  TRACK_GAP_BOUNDS,
  CHIP_PADDING_BOUNDS,
} from '@/composables/state/useSettings'
import { useDialog } from '@/composables/state/useDialog'
import { useTemplateStore } from '@/stores/useTemplateStore'
import { useGeneralBlockStore } from '@/stores/useGeneralBlockStore'
import { useSavedTeamStore } from '@/stores/useSavedTeamStore'
import { showToast } from '@/composables/state/useToast'
import { useI18n } from 'vue-i18n'
import { SUPPORTED_LOCALES } from '@/i18n'

const { settings } = useSettings()
const { t } = useI18n()

// 數值設定：輸入後夾回範圍再寫入（防手打超界值）。
function onHistoryInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  settings.value.historyLimit = clampSetting(v, HISTORY_LIMIT_BOUNDS, settings.value.historyLimit)
}
function onTrackGapInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  settings.value.trackGapPx = clampSetting(v, TRACK_GAP_BOUNDS, settings.value.trackGapPx)
}
// 自製 ▲▼ 步進（取代原生 spin button：樣式不搭且與數字重疊）。夾回範圍。
function stepHistory(dir: number): void {
  settings.value.historyLimit = clampSetting(
    settings.value.historyLimit + dir, HISTORY_LIMIT_BOUNDS, settings.value.historyLimit,
  )
}
function stepTrackGap(dir: number): void {
  settings.value.trackGapPx = clampSetting(
    settings.value.trackGapPx + dir, TRACK_GAP_BOUNDS, settings.value.trackGapPx,
  )
}
function onChipPaddingInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  settings.value.chipPaddingPx = clampSetting(v, CHIP_PADDING_BOUNDS, settings.value.chipPaddingPx)
}
function stepChipPadding(dir: number): void {
  settings.value.chipPaddingPx = clampSetting(
    settings.value.chipPaddingPx + dir, CHIP_PADDING_BOUNDS, settings.value.chipPaddingPx,
  )
}
const dialog = useDialog()
const templateStore = useTemplateStore()
const generalBlockStore = useGeneralBlockStore()
const savedTeamStore = useSavedTeamStore()

const isOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
// 面板 Teleport 到 body（避開標題列的 overflow:hidden 裁切與堆疊脈絡），
// 以 fixed 定位；座標於開啟時由齒輪鈕的 rect 算出（貼齊鈕右下）。
const panelStyle = ref<Record<string, string>>({})

function toggle(): void {
  if (!isOpen.value) {
    const rect = rootRef.value?.getBoundingClientRect()
    if (rect) {
      panelStyle.value = {
        top: `${rect.bottom + 8}px`,
        right: `${window.innerWidth - rect.right}px`,
      }
    }
  }
  isOpen.value = !isOpen.value
}

// 外點關閉：點擊落在觸發鈕與面板兩者之外 → 收合。
// 面板已 Teleport 到 body（不在 rootRef 內），故須一併排除 panelRef。
function onDocClick(event: MouseEvent): void {
  if (!isOpen.value) return
  const target = event.target as Node
  const inTrigger = rootRef.value?.contains(target)
  const inPanel = panelRef.value?.contains(target)
  if (!inTrigger && !inPanel) isOpen.value = false
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isOpen.value) isOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick, true)
  window.removeEventListener('keydown', onKeydown)
})

// 清除資料：danger confirm 二次確認 → 通用區塊與匯出設定還原預設、
// 刪除自訂模板庫與隊伍存檔。
async function handleClearData(): Promise<void> {
  const ok = await dialog.confirm({
    title: t('settings.clearConfirmTitle'),
    message: t('settings.clearConfirmMessage'),
    confirmText: t('settings.clearConfirm'),
    cancelText: t('dialog.cancel'),
    danger: true,
  })
  if (!ok) return
  generalBlockStore.resetToDefaults()
  resetExportSettings()
  templateStore.clearAllTemplates()
  savedTeamStore.clearAllTeams()
  showToast(t('toast.dataCleared'), 'success')
  isOpen.value = false
}
</script>

<template>
  <div ref="rootRef" class="settings-menu">
    <!-- 齒輪觸發鈕 -->
    <button
      type="button"
      class="settings-menu__trigger"
      :class="{ 'settings-menu__trigger--open': isOpen }"
      :title="$t('settings.gearLabel')"
      :aria-label="$t('settings.gearLabel')"
      :aria-expanded="isOpen"
      aria-haspopup="menu"
      @click.stop="toggle"
    >
      <svg class="settings-menu__gear" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M11.49 2.17a1.5 1.5 0 0 0-2.98 0l-.1.86a1.5 1.5 0 0 1-2.1.87l-.78-.37a1.5 1.5 0 0 0-2.1 2.1l.36.78a1.5 1.5 0 0 1-.87 2.1l-.86.1a1.5 1.5 0 0 0 0 2.98l.86.1a1.5 1.5 0 0 1 .87 2.1l-.37.78a1.5 1.5 0 0 0 2.1 2.1l.78-.36a1.5 1.5 0 0 1 2.1.87l.1.86a1.5 1.5 0 0 0 2.98 0l.1-.86a1.5 1.5 0 0 1 2.1-.87l.78.37a1.5 1.5 0 0 0 2.1-2.1l-.36-.78a1.5 1.5 0 0 1 .87-2.1l.86-.1a1.5 1.5 0 0 0 0-2.98l-.86-.1a1.5 1.5 0 0 1-.87-2.1l.37-.78a1.5 1.5 0 0 0-2.1-2.1l-.78.36a1.5 1.5 0 0 1-2.1-.87l-.1-.86Z"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
        <circle cx="10" cy="10" r="2.6" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>

    <!-- 下拉面板：Teleport 到 body 避開標題列 overflow 裁切；fixed 定位 -->
    <Teleport to="body">
      <Transition name="settings-pop">
        <div
          v-if="isOpen"
          ref="panelRef"
          class="settings-menu__panel"
          role="menu"
          :style="panelStyle"
          @click.stop
        >
          <div class="settings-menu__heading">{{ $t('settings.heading') }}</div>

        <!-- 語言切換：選項顯示各語言母語名（不翻譯），值同步 i18n locale -->
        <label class="settings-menu__row">
          <span class="settings-menu__label">{{ $t('settings.language') }}</span>
          <select v-model="settings.language" class="settings-menu__select">
            <option v-for="loc in SUPPORTED_LOCALES" :key="loc.value" :value="loc.value">
              {{ loc.label }}
            </option>
          </select>
        </label>

        <!-- 大寫鎖定 -->
        <label class="settings-menu__row settings-menu__row--clickable">
          <span class="settings-menu__label">
            {{ $t('settings.capsLock') }}
            <span class="settings-menu__hint">{{ $t('settings.capsLockHint') }}</span>
          </span>
          <input
            v-model="settings.autoUppercase"
            type="checkbox"
            class="settings-menu__switch"
            role="switch"
            :aria-checked="settings.autoUppercase"
          />
        </label>

        <!-- 動畫效果 -->
        <label class="settings-menu__row settings-menu__row--clickable">
          <span class="settings-menu__label">
            {{ $t('settings.animations') }}
            <span class="settings-menu__hint">{{ $t('settings.animationsHint') }}</span>
          </span>
          <input
            v-model="settings.animationsEnabled"
            type="checkbox"
            class="settings-menu__switch"
            role="switch"
            :aria-checked="settings.animationsEnabled"
          />
        </label>

        <div class="settings-menu__divider" aria-hidden="true" />

        <!-- 復原步數 -->
        <label class="settings-menu__row">
          <span class="settings-menu__label">
            {{ $t('settings.historyLimit') }}
            <span class="settings-menu__hint">{{ $t('settings.historyLimitHint', { min: HISTORY_LIMIT_BOUNDS.min, max: HISTORY_LIMIT_BOUNDS.max }) }}</span>
          </span>
          <span class="settings-menu__number-field">
            <input
              class="settings-menu__number"
              type="number"
              :min="HISTORY_LIMIT_BOUNDS.min"
              :max="HISTORY_LIMIT_BOUNDS.max"
              :value="settings.historyLimit"
              @change="onHistoryInput"
            />
            <span class="settings-menu__stepper" aria-hidden="true">
              <button type="button" class="settings-menu__step" tabindex="-1" @click.prevent="stepHistory(1)">▲</button>
              <button type="button" class="settings-menu__step" tabindex="-1" @click.prevent="stepHistory(-1)">▼</button>
            </span>
          </span>
        </label>

        <!-- 區塊間距 -->
        <label class="settings-menu__row">
          <span class="settings-menu__label">
            {{ $t('settings.trackGap') }}
            <span class="settings-menu__hint">{{ $t('settings.trackGapHint', { min: TRACK_GAP_BOUNDS.min, max: TRACK_GAP_BOUNDS.max }) }}</span>
          </span>
          <span class="settings-menu__number-field">
            <input
              class="settings-menu__number"
              type="number"
              :min="TRACK_GAP_BOUNDS.min"
              :max="TRACK_GAP_BOUNDS.max"
              :value="settings.trackGapPx"
              @change="onTrackGapInput"
            />
            <span class="settings-menu__stepper" aria-hidden="true">
              <button type="button" class="settings-menu__step" tabindex="-1" @click.prevent="stepTrackGap(1)">▲</button>
              <button type="button" class="settings-menu__step" tabindex="-1" @click.prevent="stepTrackGap(-1)">▼</button>
            </span>
          </span>
        </label>

        <!-- 區塊文字邊距 -->
        <label class="settings-menu__row">
          <span class="settings-menu__label">
            {{ $t('settings.chipPadding') }}
            <span class="settings-menu__hint">{{ $t('settings.chipPaddingHint', { min: CHIP_PADDING_BOUNDS.min, max: CHIP_PADDING_BOUNDS.max }) }}</span>
          </span>
          <span class="settings-menu__number-field">
            <input
              class="settings-menu__number"
              type="number"
              :min="CHIP_PADDING_BOUNDS.min"
              :max="CHIP_PADDING_BOUNDS.max"
              :value="settings.chipPaddingPx"
              @change="onChipPaddingInput"
            />
            <span class="settings-menu__stepper" aria-hidden="true">
              <button type="button" class="settings-menu__step" tabindex="-1" @click.prevent="stepChipPadding(1)">▲</button>
              <button type="button" class="settings-menu__step" tabindex="-1" @click.prevent="stepChipPadding(-1)">▼</button>
            </span>
          </span>
        </label>

        <!-- 記住匯出設定 -->
        <label class="settings-menu__row settings-menu__row--clickable">
          <span class="settings-menu__label">
            {{ $t('settings.rememberExport') }}
            <span class="settings-menu__hint">{{ $t('settings.rememberExportHint') }}</span>
          </span>
          <input
            v-model="settings.rememberExport"
            type="checkbox"
            class="settings-menu__switch"
            role="switch"
            :aria-checked="settings.rememberExport"
          />
        </label>

        <div class="settings-menu__divider" aria-hidden="true" />

        <!-- 清除資料（危險操作） -->
        <div class="settings-menu__row settings-menu__row--column">
          <span class="settings-menu__label">
            {{ $t('settings.clearData') }}
            <span class="settings-menu__hint">{{ $t('settings.clearDataHint') }}</span>
          </span>
          <button type="button" class="settings-menu__danger-btn" @click="handleClearData">
            {{ $t('settings.clearBtn') }}
          </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.settings-menu {
  position: relative;
  display: inline-flex;
}

/* ── 齒輪觸發鈕：與匯出鈕同列，中性暗色（匯出為青色主行動，齒輪退居次要） ── */
.settings-menu__trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.04);
  color: rgba(240, 244, 248, 0.65);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.settings-menu__trigger:hover,
.settings-menu__trigger--open {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.35);
  color: rgba(240, 244, 248, 0.95);
}
.settings-menu__trigger:focus {
  outline: none;
}
.settings-menu__trigger:focus-visible {
  border-color: rgba(34, 211, 238, 0.6);
  color: rgba(34, 211, 238, 0.95);
}
.settings-menu__gear {
  width: 1.125rem;
  height: 1.125rem;
}

/* ── 下拉面板 ─────────────────────────────────────────────── */
.settings-menu__panel {
  /* Teleport 到 body → fixed 定位；top/right 由 JS 依齒輪鈕 rect 注入。 */
  position: fixed;
  z-index: 200;
  width: 15.5rem;
  /* 內容過長（如英文較高）時不超出視窗：夾住高度並內部捲動。
     top 由 JS 注入（約 header 底 56px），故上下各留約 1rem 邊距。 */
  max-height: calc(100vh - 72px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0.625rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background-color: #111827;
  box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.7);
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  scrollbar-width: thin;
  scrollbar-color: rgba(34, 211, 238, 0.25) transparent;
}
.settings-menu__panel::-webkit-scrollbar {
  width: 6px;
}
.settings-menu__panel::-webkit-scrollbar-thumb {
  background-color: rgba(34, 211, 238, 0.25);
  border-radius: 3px;
}

.settings-menu__heading {
  padding: 0 0.25rem 0.5rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(34, 211, 238, 0.75);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 0.5rem;
}

.settings-menu__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 0.25rem;
}
.settings-menu__row--clickable {
  cursor: pointer;
  border-radius: 4px;
}
.settings-menu__row--clickable:hover {
  background-color: rgba(255, 255, 255, 0.04);
}
.settings-menu__row--column {
  flex-direction: column;
  align-items: stretch;
  gap: 0.45rem;
}

.settings-menu__label {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 0.8125rem;
  color: rgba(240, 244, 248, 0.9);
  user-select: none;
}
.settings-menu__hint {
  font-size: 0.6563rem;
  color: rgba(240, 244, 248, 0.45);
  letter-spacing: 0.02em;
}

.settings-menu__select {
  flex-shrink: 0;
  max-width: 8rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background-color: #0d1320;
  color: rgba(240, 244, 248, 0.9);
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
.settings-menu__select:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.6);
  outline-offset: 1px;
}

/* 數字欄：輸入框 + 自製 ▲▼ 步進鈕（取代原生 spin button，樣式一致且不重疊）。 */
.settings-menu__number-field {
  flex-shrink: 0;
  display: inline-flex;
  align-items: stretch;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background-color: #0d1320;
  overflow: hidden;
}
.settings-menu__number-field:focus-within {
  border-color: rgba(34, 211, 238, 0.6);
}

.settings-menu__number {
  width: 3rem;
  padding: 0.25rem 0.4rem;
  border: none;
  background: transparent;
  color: rgba(240, 244, 248, 0.9);
  font-family: inherit;
  font-size: 0.75rem;
  text-align: right;
  outline: none;
}
/* 隱藏原生 spin button（Chromium/WebKit 與 Firefox）。 */
.settings-menu__number::-webkit-outer-spin-button,
.settings-menu__number::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.settings-menu__number {
  -moz-appearance: textfield;
}

/* 步進鈕直排 ▲▼，帶左分隔線，青色主題呼應全站。 */
.settings-menu__stepper {
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(255, 255, 255, 0.14);
}
.settings-menu__step {
  flex: 1;
  width: 1.1rem;
  padding: 0;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(240, 244, 248, 0.55);
  font-size: 0.5rem;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.settings-menu__step:first-child {
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}
.settings-menu__step:hover {
  background: rgba(34, 211, 238, 0.16);
  color: rgba(34, 211, 238, 0.95);
}
.settings-menu__step:active {
  background: rgba(34, 211, 238, 0.28);
}

/* 開關：以原生 checkbox 重繪為 pill 開關（無 JS） */
.settings-menu__switch {
  appearance: none;
  flex-shrink: 0;
  width: 2.125rem;
  height: 1.125rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background-color: rgba(255, 255, 255, 0.08);
  position: relative;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.settings-menu__switch::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 1px;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
  background-color: rgba(240, 244, 248, 0.75);
  transition: transform 0.15s ease, background-color 0.15s ease;
}
.settings-menu__switch:checked {
  background-color: rgba(34, 211, 238, 0.35);
  border-color: rgba(34, 211, 238, 0.7);
}
.settings-menu__switch:checked::after {
  transform: translateX(1rem);
  background-color: #22d3ee;
}
.settings-menu__switch:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.6);
  outline-offset: 2px;
}

.settings-menu__divider {
  height: 1px;
  margin: 0.375rem 0;
  background: rgba(255, 255, 255, 0.08);
}

/* 清除資料：紅色警示鈕 */
.settings-menu__danger-btn {
  width: 100%;
  padding: 0.4rem 0.75rem;
  border: 1px solid rgba(239, 68, 68, 0.55);
  border-radius: 4px;
  background-color: rgba(239, 68, 68, 0.08);
  color: #f87171;
  font-family: inherit;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.settings-menu__danger-btn:hover {
  background-color: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.8);
  color: #fca5a5;
}
.settings-menu__danger-btn:focus-visible {
  outline: 1px solid rgba(239, 68, 68, 0.7);
  outline-offset: 1px;
}

/* 面板進出場：只動 opacity（transform 位移易與其他層互動出怪） */
.settings-pop-enter-active,
.settings-pop-leave-active {
  transition: opacity 0.12s ease;
}
.settings-pop-enter-from,
.settings-pop-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .settings-pop-enter-active,
  .settings-pop-leave-active,
  .settings-menu__switch,
  .settings-menu__switch::after {
    transition: none;
  }
}
</style>

<script setup lang="ts">
// ============================================================
// HotkeyMapDialog.vue — 熱鍵對映表編輯視窗。
//
// 掛載於 App.vue 頂層，透過 Teleport 渲染至 <body>；由 useHotkeyMapDialog 單例
// 控制開合，內容即時寫入 useHotkeyMap（無「確定 / 取消」的暫存草稿）。
//
// 職責（見 DesignDocument/HotkeyInputMode.md §4）：
//   - 每條條目一列：label 文字欄 + 按鍵擷取欄 + pressType 切換 + 刪除鈕。
//   - 底部「新增條目」與「還原預設」。
//   - 錄入時擋保留鍵（RESERVED_CODES）、即時偵測衝突（同 hotkey + pressType）。
//
// 設計決策：
//   - 擷取以 window capture-phase 一次性監聽 keydown＋mousedown，
//     stopImmediatePropagation 擋住全域快捷鍵（否則錄入時按下的鍵會誤觸 App
//     快捷鍵，如 F 進入熱鍵模式）；contextmenu 一併攔下避免右鍵彈選單。
//   - 鍵位比對用 event.code；顯示走 formatHotkey。
//   - 滑鼠鍵擷取（Stage 3）：擷取中按滑鼠左／右鍵即錄入 MouseLeft／MouseRight。
//     取消擷取改按 Escape（擷取中的左鍵點擊會被當成 MouseLeft 錄入）。
//   - 衝突＝同鍵同 pressType 的既有條目：以 dialog.confirm 詢問「覆蓋」
//     （新條目取得該鍵、原持有者清空鍵位）或「取消」（不變更）。
//   - 介面字串暫以繁中字面量（沿用 Stage 1 慣例，Stage 4 統一進 i18n）。
// ============================================================

import { ref, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHotkeyMapDialog } from '@/composables/state/useHotkeyMapDialog'
import { useHotkeyMap } from '@/composables/state/useHotkeyMap'
import { useDialog } from '@/composables/state/useDialog'
import { RESERVED_CODES, formatHotkey, MOUSE_LEFT, MOUSE_RIGHT } from '@/constants/hotkeyMap'
import type { PressType } from '@/types/hotkey'

const { isOpen, close } = useHotkeyMapDialog()
const { entries, introEntries, conflictIds, hasConflict, addEntry, updateEntry, removeEntry, updateIntro, resetToDefaults } = useHotkeyMap()
const dialog = useDialog()
const { t } = useI18n()

// 正在擷取鍵位的條目 id（null＝無）。
const capturingId = ref<string | null>(null)
// 擷取時的即時錯誤提示（保留鍵）；切換條目或成功即清除。
const captureError = ref<string>('')
// 已按下、待 Enter 確認的鍵位（null＝尚未按鍵）；擷取欄先顯示它，Enter 才提交。
const pendingHotkey = ref<string | null>(null)
// 剛成功綁定、正在閃爍回饋的條目 id（null＝無）；動畫結束即清除。
const flashId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined

/** 該列要顯示在擷取欄左側的紅色警語：僅「正在擷取且錄到保留鍵」時出現（類型二）。
 *  重複鍵位（類型一）不走這裡，只靠擷取欄本身的紅框樣式 + 完成鈕旁單一訊息。 */
function reservedWarnFor(id: string): string {
  return capturingId.value === id ? captureError.value : ''
}

/** 開始擷取某條目的鍵位：掛 window capture-phase 監聽（鍵盤＋滑鼠左鍵 click＋右鍵 contextmenu）。 */
function startCapture(id: string): void {
  if (capturingId.value !== null) stopCapture()
  capturingId.value = id
  captureError.value = ''
  pendingHotkey.value = null
  window.addEventListener('keydown', onCaptureKeydown, { capture: true })
  window.addEventListener('click', onCaptureClick, { capture: true })
  window.addEventListener('contextmenu', onCaptureContextMenu, { capture: true })
}

/** 結束擷取：解除監聽、清狀態。 */
function stopCapture(): void {
  window.removeEventListener('keydown', onCaptureKeydown, { capture: true })
  window.removeEventListener('click', onCaptureClick, { capture: true })
  window.removeEventListener('contextmenu', onCaptureContextMenu, { capture: true })
  capturingId.value = null
  captureError.value = ''
  pendingHotkey.value = null
}

/** 擷取中的 keydown：讀 event.code，擋保留鍵，其餘先暫存待確認；Enter 提交、Escape 取消。 */
function onCaptureKeydown(event: KeyboardEvent): void {
  // 擋住全域快捷鍵與瀏覽器預設（錄入期間按鍵只作錄入用途）。
  event.preventDefault()
  event.stopImmediatePropagation()

  // Escape：取消擷取（Escape 本為保留鍵，一律當退出錄入）。
  if (event.code === 'Escape') {
    stopCapture()
    return
  }
  // Enter：提交已暫存的鍵位（尚未按任何鍵則忽略，繼續等待）。
  if (event.code === 'Enter' || event.code === 'NumpadEnter') {
    if (pendingHotkey.value !== null) applyCapture(pendingHotkey.value)
    return
  }
  // 純修飾鍵／保留鍵單獨按下：顯示警語，不暫存。
  if (RESERVED_CODES.has(event.code)) {
    captureError.value = t('hotkey.reservedKey', { key: formatHotkey(event.code, t) })
    return
  }

  // 暫存待確認（顯示於擷取欄，Enter 才落定）。
  captureError.value = ''
  pendingHotkey.value = event.code
}

/**
 * 擷取中的 click（capture-phase）：左鍵暫存 MouseLeft（待 Enter 確認）。
 * 當場 stopImmediatePropagation 即不外洩,不需再「吞下一次 click」。
 */
function onCaptureClick(event: MouseEvent): void {
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.button !== 0) return
  captureError.value = ''
  pendingHotkey.value = MOUSE_LEFT
}

/** 擷取中的 contextmenu：暫存 MouseRight（待 Enter 確認）並攔下右鍵選單。 */
function onCaptureContextMenu(event: MouseEvent): void {
  event.preventDefault()
  event.stopImmediatePropagation()
  captureError.value = ''
  pendingHotkey.value = MOUSE_RIGHT
}

/** 把擷取到的鍵位寫入目前條目並結束擷取（重複鍵位改由設定頁就地紅字處理,不在此擋）。 */
function applyCapture(hotkey: string): void {
  const id = capturingId.value
  if (id === null) return
  updateEntry(id, { hotkey })
  stopCapture()
  // 綁定後與既有條目撞鍵（同鍵同型別）：改由擷取欄紅框示警，不播綠色成功閃爍。
  if (conflictIds.value.has(id)) return
  // 成功綁定回饋：讓該擷取欄綠色邊框閃一下（動畫較慢、只閃一次，結束後清旗標）。
  flashId.value = id
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashId.value = null }, 1100)
}

/** 切換 pressType（tap ↔ hold）。 */
function setPressType(id: string, pressType: PressType): void {
  updateEntry(id, { pressType })
}

/** label 輸入即時寫回（trim 留到使用；空 label 於模式輸入時自然不動作）。 */
function onLabelInput(id: string, event: Event): void {
  updateEntry(id, { label: (event.target as HTMLInputElement).value })
}

/** 入場技 label 即時寫回（依 slot）。 */
function onIntroLabelInput(slot: 1 | 2 | 3, event: Event): void {
  updateIntro(slot, { label: (event.target as HTMLInputElement).value })
}

/** 切換入場技捷徑啟停。 */
function toggleIntro(slot: 1 | 2 | 3, enabled: boolean): void {
  updateIntro(slot, { enabled: !enabled })
}

async function handleReset(): Promise<void> {
  const ok = await dialog.confirm({
    title: t('hotkey.resetConfirmTitle'),
    message: t('hotkey.resetConfirmMessage'),
    confirmText: t('hotkey.resetConfirm'),
    cancelText: t('hotkey.cancel'),
    danger: true,
  })
  if (ok) resetToDefaults()
}

/** 點背景關閉：擷取中不關閉（此時任何點擊都作錄入用途，見 spotlight）。 */
function onBackdropClick(): void {
  if (capturingId.value !== null) return
  handleClose()
}

/** 關閉視窗：一併結束擷取。 */
function handleClose(): void {
  stopCapture()
  close()
}

onUnmounted(() => {
  stopCapture()
  if (flashTimer) clearTimeout(flashTimer)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="hkmap-map">
      <div v-if="isOpen" class="hkmap-overlay" @click.self="onBackdropClick">
        <div
          class="hkmap-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="$t('hotkey.mapLabel')"
          @keydown.esc.prevent="handleClose"
        >
          <h2 class="hkmap-dialog__title">{{ $t('hotkey.mapTitle') }}</h2>
          <i18n-t keypath="hotkey.mapDesc" tag="p" class="hkmap-dialog__desc" scope="global">
            <template #key><kbd>F</kbd></template>
          </i18n-t>

          <!-- 表頭 -->
          <div class="hkmap-row hkmap-row--head" aria-hidden="true">
            <span class="hkmap-col hkmap-col--label">{{ $t('hotkey.colLabel') }}</span>
            <span class="hkmap-col hkmap-col--key">{{ $t('hotkey.colKey') }}</span>
            <span class="hkmap-col hkmap-col--press">{{ $t('hotkey.colPress') }}</span>
            <span class="hkmap-col hkmap-col--del"></span>
          </div>

          <!-- 入場技長按捷徑（釘選頂端；鍵與長按鎖定，以開關啟停） -->
          <ul class="hkmap-list hkmap-list--intro">
            <li v-for="intro in introEntries" :key="`intro-${intro.slot}`" class="hkmap-row">
              <!-- label（可編輯） -->
              <input
                class="hkmap-col hkmap-col--label hkmap-label-input"
                type="text"
                :value="intro.label"
                :placeholder="$t('hotkey.labelPlaceholder')"
                maxlength="12"
                @input="onIntroLabelInput(intro.slot, $event)"
              />

              <!-- 按鍵（鎖定：顯示 1/2/3，不可擷取） -->
              <div class="hkmap-col hkmap-col--key">
                <span class="hkmap-locked">{{ formatHotkey('Digit' + intro.slot, t) }}</span>
              </div>

              <!-- 按法（鎖定：長按） -->
              <div class="hkmap-col hkmap-col--press">
                <span class="hkmap-locked">{{ $t('hotkey.pressHold') }}</span>
              </div>

              <!-- 啟停開關（取代刪除鈕） -->
              <button
                type="button"
                role="switch"
                class="hkmap-col hkmap-col--del hkmap-toggle"
                :class="{ 'hkmap-toggle--on': intro.enabled }"
                :aria-checked="intro.enabled"
                :title="$t('hotkey.introToggle')"
                :aria-label="$t('hotkey.introToggle')"
                @click="toggleIntro(intro.slot, intro.enabled)"
              ><span class="hkmap-toggle__knob" aria-hidden="true"></span></button>
            </li>
          </ul>
          <hr class="hkmap-divider" aria-hidden="true" />

          <!-- 條目清單 -->
          <ul class="hkmap-list">
            <li v-for="entry in entries" :key="entry.id" class="hkmap-row">
              <!-- label -->
              <input
                class="hkmap-col hkmap-col--label hkmap-label-input"
                type="text"
                :value="entry.label"
                :placeholder="$t('hotkey.labelPlaceholder')"
                maxlength="12"
                @input="onLabelInput(entry.id, $event)"
              />

              <!-- 按鍵擷取欄（wrapper：容納「左側」保留鍵警語，相對擷取欄定位） -->
              <div class="hkmap-col hkmap-col--key hkmap-keywrap">
                <span v-if="reservedWarnFor(entry.id)" class="hkmap-key-warn">
                  {{ reservedWarnFor(entry.id) }}
                </span>
                <button
                  type="button"
                  class="hkmap-capture"
                  :class="{
                    'hkmap-capture--active': capturingId === entry.id,
                    'hkmap-capture--conflict': conflictIds.has(entry.id),
                    'hkmap-capture--flash': flashId === entry.id,
                  }"
                  @click="capturingId === entry.id ? stopCapture() : startCapture(entry.id)"
                >
                  <template v-if="capturingId === entry.id">{{ pendingHotkey ? formatHotkey(pendingHotkey, t) : $t('hotkey.capturePrompt') }}</template>
                  <template v-else-if="entry.hotkey">{{ formatHotkey(entry.hotkey, t) }}</template>
                  <template v-else>{{ $t('hotkey.keyUnset') }}</template>
                </button>
              </div>

              <!-- pressType 切換 -->
              <div class="hkmap-col hkmap-col--press hkmap-press">
                <button
                  type="button"
                  class="hkmap-press__seg"
                  :class="{ 'hkmap-press__seg--on': entry.pressType === 'tap' }"
                  @click="setPressType(entry.id, 'tap')"
                >{{ $t('hotkey.pressTap') }}</button>
                <button
                  type="button"
                  class="hkmap-press__seg"
                  :class="{ 'hkmap-press__seg--on': entry.pressType === 'hold' }"
                  @click="setPressType(entry.id, 'hold')"
                >{{ $t('hotkey.pressHold') }}</button>
              </div>

              <!-- 刪除 -->
              <button
                type="button"
                class="hkmap-col hkmap-col--del hkmap-del"
                :title="$t('hotkey.deleteEntry')"
                :aria-label="$t('hotkey.deleteEntry')"
                @click="removeEntry(entry.id)"
              >✕</button>
            </li>
          </ul>

          <!-- 底部動作 -->
          <div class="hkmap-dialog__actions">
            <button type="button" class="hkmap-btn hkmap-btn--ghost" @click="addEntry()">{{ $t('hotkey.addEntry') }}</button>
            <button type="button" class="hkmap-btn hkmap-btn--ghost" @click="handleReset">{{ $t('hotkey.resetDefaults') }}</button>
            <span class="hkmap-dialog__spacer" />
            <!-- 類型一：重複鍵位 → 完成鈕左側單一警語 + 停用完成 -->
            <span v-if="hasConflict" class="hkmap-dialog__conflict">{{ $t('hotkey.conflictKey') }}</span>
            <button
              type="button"
              class="hkmap-btn hkmap-btn--confirm"
              :disabled="hasConflict"
              @click="handleClose"
            >{{ $t('hotkey.done') }}</button>
          </div>

          <!-- 錄入聚光燈：擷取中壓暗整個視窗、只讓作用中的擷取欄透出，
               並鎖住其餘互動（實際攔截由 window capture-phase 監聽負責）。
               提示膠囊抽為 spotlight 的兄弟節點,z-index 高於作用欄 → 不被抬起的欄蓋住。 -->
          <template v-if="capturingId !== null">
            <div class="hkmap-spotlight" aria-hidden="true"></div>
            <i18n-t keypath="hotkey.captureHint" tag="div" class="hkmap-spotlight__hint" aria-hidden="true" scope="global">
              <template #enter><kbd>Enter</kbd></template>
              <template #esc><kbd>Esc</kbd></template>
            </i18n-t>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.hkmap-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(3, 6, 12, 0.62);
  backdrop-filter: blur(2px);
}

.hkmap-dialog {
  position: relative; /* 聚光燈（.hkmap-spotlight）與透出的擷取欄以此為定位／堆疊基準 */
  width: min(34rem, 100%);
  max-height: calc(100vh - 3rem);
  overflow-y: auto;
  padding: 1.25rem 1.35rem 1.1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: #111827;
  box-shadow: 0 18px 48px -12px rgba(0, 0, 0, 0.75);
  font-family: var(--app-font-mono, 'JetBrains Mono', 'Fira Code', ui-monospace, monospace);
  scrollbar-width: thin;
  scrollbar-color: rgba(34, 211, 238, 0.25) transparent;
}

.hkmap-dialog__title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(34, 211, 238, 0.95);
}
.hkmap-dialog__desc {
  margin: 0 0 0.85rem;
  font-size: 0.7rem;
  line-height: 1.5;
  color: rgba(240, 244, 248, 0.5);
}
.hkmap-dialog__desc kbd {
  padding: 0 0.3em;
  font-size: 0.65rem;
  color: rgba(240, 244, 248, 0.9);
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 3px;
}

/* 四欄格線：label 彈性、其餘固定寬。末欄放大以容納啟停開關（刪除鈕仍置中）。 */
.hkmap-row {
  display: grid;
  grid-template-columns: 1fr 6.5rem 6.5rem 2rem;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}
.hkmap-row--head {
  padding-bottom: 0.35rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 0.25rem;
}
.hkmap-row--head .hkmap-col {
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(240, 244, 248, 0.4);
}

.hkmap-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 22rem;
  overflow-y: auto;
}

.hkmap-label-input {
  min-width: 0;
  padding: 0.3rem 0.45rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background: #0d1320;
  color: rgba(240, 244, 248, 0.92);
  font-family: inherit;
  font-size: 0.78rem;
  outline: none;
}
.hkmap-label-input:focus {
  border-color: rgba(34, 211, 238, 0.6);
}

.hkmap-capture {
  padding: 0.3rem 0.4rem;
  border: 1px dashed rgba(255, 255, 255, 0.28);
  border-radius: 4px;
  background: #0d1320;
  color: rgba(240, 244, 248, 0.85);
  font-family: inherit;
  font-size: 0.72rem;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}
.hkmap-capture:hover {
  border-color: rgba(34, 211, 238, 0.5);
}
/* 移除原生焦點外框（橘白虛線）；焦點提示改用青色實線邊框。 */
.hkmap-capture:focus {
  outline: none;
}
.hkmap-capture:focus-visible {
  border-style: solid;
  border-color: rgba(34, 211, 238, 0.7);
}
/* 錄入中：脫離原列、固定置中於視窗（比照 VSCode 快捷鍵錄入的置中面板），
   抬到聚光燈之上（z-index 6 > .hkmap-spotlight 的 5）並發光，成為畫面上唯一
   透出、聚焦的欄位 —— 不再停在原格,故不會被底部提示膠囊蓋住。
   pointer-events:none → 點作用欄本身不觸發 @click（不會關掉錄入）,點擊穿透到
   聚光燈層,由 window capture-phase click 收成 MouseLeft；取消改按 Esc（問題 3）。
   用 fixed 對齊視窗中央,與聚光燈的可視中心一致（避免對映視窗捲動時錯位）。
   選擇器疊 .hkmap-capture.hkmap-capture--active 提升權重,覆蓋較後定義的
   .hkmap-keywrap .hkmap-capture 的 width:100%。 */
.hkmap-keywrap .hkmap-capture.hkmap-capture--active {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 6;
  width: 13rem;
  max-width: calc(100vw - 3rem);
  padding: 0.6rem 0.9rem;
  pointer-events: none;
  border-style: solid;
  border-color: rgba(34, 211, 238, 0.9);
  color: rgba(34, 211, 238, 0.95);
  background: #0d1320;
  font-size: 0.82rem;
  text-align: center;
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.55), 0 0 24px rgba(34, 211, 238, 0.45), 0 16px 48px -8px rgba(0, 0, 0, 0.7);
}

/* 成功綁定回饋：僅擷取欄邊框綠色閃一下（不動底色/文字），動畫慢、只閃一次。
   動畫在 flashId 命中期間掛載,結束由旗標清除卸下。 */
.hkmap-capture--flash {
  animation: hkmap-capture-flash 1s ease;
}
@keyframes hkmap-capture-flash {
  0%   { border-color: rgba(255, 255, 255, 0.28); }
  40%  { border-color: rgba(74, 222, 128, 0.95); }
  100% { border-color: rgba(255, 255, 255, 0.28); }
}
@media (prefers-reduced-motion: reduce) {
  .hkmap-capture--flash {
    animation: none;
  }
}

/* 重複鍵位衝突（類型一）：擷取欄轉紅警示；文字警語不在此,改置於完成鈕左側。 */
.hkmap-capture--conflict {
  border-style: solid;
  border-color: rgba(248, 113, 113, 0.85);
  color: rgba(248, 113, 113, 0.95);
  background: rgba(248, 113, 113, 0.08);
}

/* 擷取欄外層：容納「左側」保留鍵警語（絕對定位,不擠動 grid 欄寬）。 */
.hkmap-keywrap {
  position: relative;
}
.hkmap-keywrap .hkmap-capture {
  width: 100%;
}

/* 保留鍵警語（類型二）：貼在擷取欄左側,相對其位置；z-index 6 > 聚光燈 5,錄入壓暗時仍清楚。 */
.hkmap-key-warn {
  position: absolute;
  right: calc(100% + 0.4rem);
  top: 50%;
  transform: translateY(-50%);
  z-index: 6;
  white-space: nowrap;
  font-size: 0.68rem;
  line-height: 1.3;
  text-align: right;
  color: rgba(248, 113, 113, 0.92);
  pointer-events: none;
}

.hkmap-press {
  display: inline-flex;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  overflow: hidden;
}
.hkmap-press__seg {
  flex: 1;
  padding: 0.3rem 0;
  border: none;
  background: #0d1320;
  color: rgba(240, 244, 248, 0.55);
  font-family: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.hkmap-press__seg + .hkmap-press__seg {
  border-left: 1px solid rgba(255, 255, 255, 0.14);
}
.hkmap-press__seg--on {
  background: rgba(34, 211, 238, 0.18);
  color: rgba(34, 211, 238, 0.95);
}

.hkmap-del {
  justify-self: center;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(240, 244, 248, 0.55);
  font-size: 0.7rem;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.hkmap-del:hover {
  border-color: rgba(248, 113, 113, 0.6);
  background: rgba(248, 113, 113, 0.12);
  color: rgba(248, 113, 113, 0.95);
}

/* 入場技捷徑：鎖定欄（鍵位／長按）以靜態灰字呈現，不可互動。 */
.hkmap-list--intro {
  max-height: none; /* 固定三條，不需獨立捲動 */
}
.hkmap-locked {
  display: block;
  padding: 0.3rem 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  color: rgba(240, 244, 248, 0.55);
  font-size: 0.72rem;
  text-align: center;
  cursor: default;
}

/* 啟停開關（取代刪除鈕）：緊湊膠囊，開＝青、關＝灰。 */
.hkmap-toggle {
  justify-self: center;
  position: relative;
  width: 28px;
  height: 15px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.hkmap-toggle__knob {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(240, 244, 248, 0.6);
  transform: translateY(-50%);
  transition: transform 0.15s ease, background-color 0.15s ease;
}
.hkmap-toggle--on {
  background: rgba(34, 211, 238, 0.25);
  border-color: rgba(34, 211, 238, 0.6);
}
.hkmap-toggle--on .hkmap-toggle__knob {
  background: rgba(34, 211, 238, 0.95);
  transform: translate(13px, -50%);
}
.hkmap-toggle:focus {
  outline: none;
}
.hkmap-toggle:focus-visible {
  border-color: rgba(34, 211, 238, 0.8);
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.35);
}

/* 入場技與使用者自訂條目的分隔線。 */
.hkmap-divider {
  margin: 0.85rem 0 0.35rem;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

/* 類型一重複鍵位：完成鈕左側的單一警語。 */
.hkmap-dialog__conflict {
  font-size: 0.7rem;
  color: rgba(248, 113, 113, 0.9);
}

.hkmap-dialog__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 0.85rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.hkmap-dialog__spacer {
  flex: 1;
}

.hkmap-btn {
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.hkmap-btn--ghost {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(240, 244, 248, 0.8);
}
.hkmap-btn--ghost:hover {
  border-color: rgba(34, 211, 238, 0.5);
  color: rgba(34, 211, 238, 0.95);
}
.hkmap-btn--confirm {
  border: 1px solid rgba(34, 211, 238, 0.6);
  background: rgba(34, 211, 238, 0.16);
  color: rgba(34, 211, 238, 0.95);
}
.hkmap-btn--confirm:hover {
  background: rgba(34, 211, 238, 0.28);
}
/* 有重複鍵位衝突時停用完成鈕（灰、不可點）。 */
.hkmap-btn--confirm:disabled {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(240, 244, 248, 0.35);
  cursor: not-allowed;
}

/* 錄入聚光燈：覆蓋整個對映視窗、壓暗背景並吞下互動（作用中的擷取欄 z-index 高於此透出）。
   實際的鍵位／點擊攔截仍由 window capture-phase 監聽負責；此層純為視覺與保險用的點擊屏障。 */
.hkmap-spotlight {
  position: absolute;
  inset: 0;
  z-index: 5;
  border-radius: 8px;
  background: rgba(3, 6, 12, 0.66);
  backdrop-filter: blur(1px);
}
/* 提示膠囊：z-index 7 > 作用欄 6 → 抬起的擷取欄不會蓋住它（問題 4）。 */
.hkmap-spotlight__hint {
  position: absolute;
  left: 50%;
  bottom: 3.75rem;
  transform: translateX(-50%);
  z-index: 7;
  padding: 0.4rem 0.85rem;
  border: 1px solid rgba(34, 211, 238, 0.5);
  border-radius: 999px;
  background: rgba(13, 19, 32, 0.95);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  font-size: 0.72rem;
  color: rgba(34, 211, 238, 0.95);
  white-space: nowrap;
}
.hkmap-spotlight__hint kbd {
  padding: 0 0.3em;
  font-size: 0.65rem;
  color: rgba(240, 244, 248, 0.9);
  background: rgba(34, 211, 238, 0.12);
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 3px;
}

/* 進出場：只動 opacity（沿用專案慣例，避免 transform 與其他層互動）。 */
.hkmap-map-enter-active,
.hkmap-map-leave-active {
  transition: opacity 0.14s ease;
}
.hkmap-map-enter-from,
.hkmap-map-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .hkmap-map-enter-active,
  .hkmap-map-leave-active {
    transition: none;
  }
}
</style>

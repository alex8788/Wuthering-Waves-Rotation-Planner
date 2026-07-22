<script setup lang="ts">
// ============================================================
// HotkeyModeOverlay.vue — 熱鍵輸入模式的覆蓋層＋控制列。
//
// 職責：標示模式進行中（青色邊框光暈）、提供退出鈕與當前泳道指示、
//       徵用滾輪切換泳道、承接滑鼠左／右鍵輸入。僅在模式 active 時掛載。
// 設計決策：
//   - overlay 攔下滑鼠點擊作輸入訊號（模式為 modal；控制列除外，見 _fromBar）。
//     左／右鍵於 mousedown 起按、mouseup 落子（與鍵盤同走 tap/hold 判定），
//     並攔截 contextmenu 避免右鍵彈選單（§3.2）。
//   - 滾輪掛 window 且 passive:false（需 preventDefault 攔下主軸捲動），
//     元件卸載即解除 → 模式外滾輪行為不受影響。
//   - 視窗 blur／focus：暫停／恢復接收輸入（不退出模式，§3.1）。
//   - 切換輸出軸分頁＝視同退出模式（watch activeAxisId）。
//   - Stage 1 介面字串暫以繁中字面量，Stage 4 統一進 i18n。
// ============================================================

import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRotationStore } from '@/stores/useRotationStore'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useHotkeyInputMode } from '@/composables/state/useHotkeyInputMode'
import { MOUSE_LEFT, MOUSE_RIGHT } from '@/constants/hotkeyMap'
import { characterDisplayName } from '@/i18n'

const rotationStore = useRotationStore()
const characterStore = useCharacterStore()
const hotkeyMode = useHotkeyInputMode()

// 當前選中泳道的角色名（控制列指示用）。
const currentLaneName = computed<string>(() => {
  const lane = rotationStore.selectedLaneIndex
  if (lane === null) return ''
  return characterDisplayName(characterStore.slots[lane].character)
})

// 滾輪：上一條/下一條已選角泳道（循環）。preventDefault 徵用捲動。
function handleWheel(event: WheelEvent): void {
  event.preventDefault()
  if (event.deltaY === 0) return
  hotkeyMode.cycleLane(event.deltaY > 0 ? 1 : -1)
}

// 事件是否來自控制列（退出鈕等）：控制列的點擊不作輸入訊號（§3.1）。
function _fromBar(event: MouseEvent): boolean {
  return (event.target as HTMLElement).closest('.hotkey-overlay__bar') !== null
}

// 滑鼠鍵 → 對映鍵位保留字；非左右鍵回 null。
function _mouseHotkey(event: MouseEvent): string | null {
  if (event.button === 0) return MOUSE_LEFT
  if (event.button === 2) return MOUSE_RIGHT
  return null
}

// overlay 上按下滑鼠左／右鍵：起按計時（落子留到 mouseup）。
function handleMouseDown(event: MouseEvent): void {
  if (_fromBar(event)) return
  // 由暫停恢復：點回軸面覆蓋層的第一擊只作「恢復輸入」，不落子（比照回焦恢復）。
  // 涵蓋因點擊標題列而暫停（不觸發 window blur/focus）後，點回軸面的恢復路徑。
  if (hotkeyMode.paused.value) {
    hotkeyMode.resume()
    return
  }
  const hotkey = _mouseHotkey(event)
  if (hotkey && hotkeyMode.pointerDown(hotkey)) event.preventDefault()
}

// overlay 上放開滑鼠左／右鍵：依按住時長落子。
function handleMouseUp(event: MouseEvent): void {
  if (_fromBar(event)) return
  const hotkey = _mouseHotkey(event)
  if (hotkey && hotkeyMode.pointerUp(hotkey)) event.preventDefault()
}

onMounted(() => {
  window.addEventListener('wheel', handleWheel, { passive: false })
  // blur/focus：切出視窗暫停接收輸入，回焦恢復（避免 alt-tab 回來誤觸發）。
  window.addEventListener('blur', hotkeyMode.pause)
  window.addEventListener('focus', hotkeyMode.resume)
})
onUnmounted(() => {
  window.removeEventListener('wheel', handleWheel)
  window.removeEventListener('blur', hotkeyMode.pause)
  window.removeEventListener('focus', hotkeyMode.resume)
})

// 切換輸出軸分頁 = 視同退出模式。
watch(() => rotationStore.activeAxisId, () => hotkeyMode.exit())
</script>

<template>
  <div
    class="hotkey-overlay"
    @click.stop
    @mousedown="handleMouseDown"
    @mouseup="handleMouseUp"
    @contextmenu.prevent
  >
    <!-- 控制列：模式名 ＋ 當前泳道 ＋ 操作提示 ＋ 退出鈕。
         待側欄收合過渡完成、幽靈格置中後才顯示（controlsReady），
         避免在版面寬度過渡期間佈局導致提示文字換行抖動。 -->
    <Transition name="hotkey-bar">
    <div v-if="hotkeyMode.controlsReady.value" class="hotkey-overlay__bar" @click.stop @mousedown.stop @mouseup.stop>
      <span class="hotkey-overlay__title">{{ $t('hotkey.modeName') }}</span>
      <span v-if="hotkeyMode.paused.value" class="hotkey-overlay__paused">⏸ {{ $t('hotkey.paused') }}</span>
      <span v-if="currentLaneName" class="hotkey-overlay__lane">▸ {{ currentLaneName }}</span>
      <span class="hotkey-overlay__hint">
        <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>／{{ $t('hotkey.wheel') }} {{ $t('hotkey.switchLane') }} ·
        <kbd>Delete</kbd> {{ $t('hotkey.deleteLast') }}
      </span>
      <button
        type="button"
        class="hotkey-overlay__exit"
        :title="$t('hotkey.exitTitle')"
        :aria-label="$t('hotkey.exitLabel')"
        @click.stop="hotkeyMode.exit()"
      >✕ {{ $t('hotkey.exit') }}</button>
    </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 覆蓋整個主面板：內圈青色光暈標示模式中；不加底色以免遮暗軸內容。
   pointer-events 由本層承接（modal：攔下模式中的滑鼠點擊）。 */
.hotkey-overlay {
  position: absolute;
  inset: 0;
  z-index: 70; /* 高於泳道拖曳分身(60)/插入線(65)，模式中不會有拖曳並存 */
  border: 1.5px solid rgba(34, 211, 238, 0.55);
  border-radius: 6px;
  box-shadow: inset 0 0 26px rgba(34, 211, 238, 0.12);
}

/* 控制列：釘在面板底部中央的膠囊條（頂部會蓋到第一條泳道 header，底部為空白區）。 */
.hotkey-overlay__bar {
  position: absolute;
  bottom: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap; /* 窄視窗：提示折行而非超出面板被裁切 */
  gap: 0.35rem 0.75rem;
  max-width: calc(100% - 1.5rem);
  padding: 0.35rem 0.75rem;
  border: 1px solid rgba(34, 211, 238, 0.5);
  border-radius: 16px;
  background: rgba(13, 19, 32, 0.92);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
}

.hotkey-overlay__title {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: rgba(34, 211, 238, 0.95);
}

.hotkey-overlay__lane {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(245, 249, 252, 0.92);
}

.hotkey-overlay__paused {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(251, 191, 36, 0.95);
}

.hotkey-overlay__hint {
  font-size: 0.6875rem;
  color: rgba(240, 244, 248, 0.55);
}
.hotkey-overlay__hint kbd {
  display: inline-block;
  padding: 0 0.3em;
  margin: 0 0.1em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.625rem;
  line-height: 1.5;
  color: rgba(240, 244, 248, 0.9);
  background: rgba(34, 211, 238, 0.1);
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 3px;
}

.hotkey-overlay__exit {
  padding: 0.2rem 0.6rem;
  border: 1px solid rgba(248, 113, 113, 0.45);
  border-radius: 999px;
  background: rgba(248, 113, 113, 0.08);
  color: rgba(248, 113, 113, 0.95);
  font-size: 0.6875rem;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.hotkey-overlay__exit:hover {
  background: rgba(248, 113, 113, 0.18);
  border-color: rgba(248, 113, 113, 0.7);
}
.hotkey-overlay__exit:focus {
  outline: none;
}
.hotkey-overlay__exit:focus-visible {
  outline: 1px solid rgba(248, 113, 113, 0.6);
  outline-offset: 1px;
}

/* 控制列淡入：版面定型後才出現，只動 opacity（不動 transform，避免與置中定位互擾）。 */
.hotkey-bar-enter-active {
  transition: opacity 0.18s ease;
}
.hotkey-bar-enter-from {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .hotkey-bar-enter-active {
    transition: none;
  }
}
</style>

<script setup lang="ts">
// ============================================================
// HelpDialog.vue — 使用手冊視窗（第一版：僅鍵盤快捷鍵表）。
//
// 結構仿 ExportDialog / TeamManagerDialog：Teleport + Transition +
// position:fixed 置中卡片 + backdrop blur；ESC / 點 backdrop 關閉。
// z-index 對齊次級浮層（9000），低於全域 DialogHost（10000）。
//
// 快捷鍵資料以 useKeyboardShortcuts.ts 的實作為準；修飾鍵依平台顯示
// ⌘（Mac）或 Ctrl（其他）。Shift+滾輪為瀏覽器原生橫向捲動（board 可橫捲）。
// ============================================================

import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHelpDialog } from '@/composables/state/useHelpDialog'
import { useSpotlightTour } from '@/composables/state/useSpotlightTour'

const { isOpen, close } = useHelpDialog()
const tour = useSpotlightTour()
const { t } = useI18n()

// 重新觀看導覽：關閉本視窗後啟動 Spotlight Tour（會自帶示範資料）。
function replayTour(): void {
  close()
  void tour.start()
}

const isMac = navigator.userAgent.toUpperCase().includes('MAC OS')
const mod = isMac ? '⌘' : 'Ctrl' // ⌘ / Ctrl

interface Shortcut {
  keys: string[] // 每個元素為一顆按鍵；`|` 開頭表示「或」的替代組合分隔
  descKey: string
}
interface Section {
  titleKey: string
  items: Shortcut[]
}

const sections = computed<Section[]>(() => [
  {
    titleKey: 'help.secNav',
    items: [
      { keys: ['A', 'D', '|', '←', '→'], descKey: 'help.navBlocks' },
      { keys: ['W', 'S', '|', '↑', '↓'], descKey: 'help.navLanes' },
      { keys: [mod, 'A'], descKey: 'help.selectAll' },
      { keys: ['Esc'], descKey: 'help.clearSelection' },
    ],
  },
  {
    titleKey: 'help.secEdit',
    items: [
      { keys: ['Delete', '|', 'Backspace'], descKey: 'help.deleteBlocks' },
      { keys: [mod, 'C'], descKey: 'help.copy' },
      { keys: [mod, 'X'], descKey: 'help.cut' },
      { keys: [mod, 'V'], descKey: 'help.paste' },
      { keys: [mod, 'D'], descKey: 'help.duplicateRight' },
      { keys: ['Space'], descKey: 'help.insertBlank' },
      { keys: ['Enter'], descKey: 'help.editLabel' },
    ],
  },
  {
    titleKey: 'help.secHistory',
    items: [
      { keys: [mod, 'Z'], descKey: 'help.undo' },
      { keys: [mod, 'Shift', 'Z', '|', mod, 'Y'], descKey: 'help.redo' },
    ],
  },
  {
    titleKey: 'help.secTeam',
    items: [
      { keys: [mod, 'S'], descKey: 'help.saveTeam' },
      { keys: [mod, 'Shift', 'S'], descKey: 'help.saveTeamAs' },
    ],
  },
  {
    titleKey: 'help.secView',
    items: [
      { keys: ['Tab'], descKey: 'help.toggleSidebar' },
      { keys: ['Shift', t('help.wheel')], descKey: 'help.horizontalScroll' },
    ],
  },
])

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isOpen.value) close()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="help-dialog">
      <div v-if="isOpen" class="help-overlay" @click.self="close">
        <div class="help-card" role="dialog" aria-modal="true" :aria-label="t('help.title')">
          <!-- 標題列 -->
          <div class="help-card__header">
            <h2 class="help-card__title">{{ t('help.title') }}</h2>
            <button
              type="button"
              class="help-card__close"
              :title="t('help.closeLabel')"
              :aria-label="t('help.closeLabel')"
              @click="close"
            >
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </button>
          </div>

          <!-- 快捷鍵表 -->
          <div class="help-card__body">
            <section v-for="sec in sections" :key="sec.titleKey" class="help-section">
              <h3 class="help-section__title">{{ t(sec.titleKey) }}</h3>
              <ul class="help-list">
                <li v-for="item in sec.items" :key="item.descKey" class="help-row">
                  <span class="help-row__keys">
                    <template v-for="(k, i) in item.keys" :key="i">
                      <span v-if="k === '|'" class="help-row__or">/</span>
                      <kbd v-else class="help-key">{{ k }}</kbd>
                    </template>
                  </span>
                  <span class="help-row__desc">{{ t(item.descKey) }}</span>
                </li>
              </ul>
            </section>

            <!-- 底部動作列：重新觀看導覽＋GitHub 專案連結 -->
            <div class="help-footer">
              <button type="button" class="help-replay" @click="replayTour">
                <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true">
                  <path d="M15.5 6.5A6 6 0 1 0 16 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path d="M15.5 3.5v3.2h-3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                {{ t('help.replayTour') }}
              </button>
              <a
                class="help-github"
                href="https://github.com/meteor4321/Wuthering-Waves-Rotation-Planner"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                {{ t('help.githubLink') }}
              </a>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
  /* 低於全域 DialogHost（10000）。 */
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background-color: rgba(6, 10, 20, 0.62);
  backdrop-filter: blur(3px);
}

.help-card {
  width: 100%;
  max-width: 34rem;
  max-height: calc(100vh - 3rem);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(34, 211, 238, 0.28);
  border-radius: 8px;
  background-color: #0d1320;
  box-shadow: 0 20px 60px -12px rgba(0, 0, 0, 0.8);
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  overflow: hidden;
}

.help-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.125rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.help-card__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(240, 244, 248, 0.95);
}
.help-card__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.04);
  color: rgba(240, 244, 248, 0.6);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.help-card__close:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(240, 244, 248, 0.95);
}
.help-card__close:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.6);
  outline-offset: 1px;
}

.help-card__body {
  padding: 0.75rem 1.125rem 1.125rem;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(34, 211, 238, 0.25) transparent;
}
.help-card__body::-webkit-scrollbar {
  width: 6px;
}
.help-card__body::-webkit-scrollbar-thumb {
  background-color: rgba(34, 211, 238, 0.25);
  border-radius: 3px;
}

.help-section {
  margin-top: 0.875rem;
}
.help-section:first-child {
  margin-top: 0.25rem;
}
.help-section__title {
  margin: 0 0 0.4rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(34, 211, 238, 0.75);
}

/* 底部動作列：導覽鈕靠左、GitHub 連結靠右 */
.help-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}

/* 重新觀看導覽鈕：青色次要行動樣式 */
.help-replay {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  border: 1px solid rgba(34, 211, 238, 0.45);
  border-radius: 4px;
  background-color: rgba(34, 211, 238, 0.06);
  color: rgba(34, 211, 238, 0.95);
  font-family: inherit;
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.help-replay:hover {
  background-color: rgba(34, 211, 238, 0.16);
  border-color: rgba(34, 211, 238, 0.7);
}
.help-replay:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.6);
  outline-offset: 1px;
}

/* GitHub 專案連結：中性低調樣式，hover 提亮 */
.help-github {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.04);
  color: rgba(240, 244, 248, 0.72);
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  text-decoration: none;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.help-github:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.34);
  color: rgba(240, 244, 248, 0.95);
}
.help-github:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.6);
  outline-offset: 1px;
}

.help-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.help-row {
  display: grid;
  grid-template-columns: 12rem 1fr;
  align-items: center;
  gap: 0.75rem;
  padding: 0.3rem 0.25rem;
  border-radius: 4px;
}
.help-row:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.help-row__keys {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.help-row__or {
  color: rgba(240, 244, 248, 0.4);
  font-size: 0.75rem;
  padding: 0 0.1rem;
}
.help-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-bottom-color: rgba(255, 255, 255, 0.32);
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.05);
  color: rgba(240, 244, 248, 0.9);
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1.4;
  white-space: nowrap;
}
.help-row__desc {
  font-size: 0.8125rem;
  color: rgba(240, 244, 248, 0.82);
  letter-spacing: 0.01em;
}

/* 進出場：只動 opacity（transform 位移易與其他層互動出怪） */
.help-dialog-enter-active,
.help-dialog-leave-active {
  transition: opacity 0.15s ease;
}
.help-dialog-enter-from,
.help-dialog-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .help-dialog-enter-active,
  .help-dialog-leave-active {
    transition: none;
  }
}
</style>

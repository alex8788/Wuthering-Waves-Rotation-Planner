<script setup lang="ts">
// ============================================================
// TeamManagerDialog.vue — 隊伍管理浮層（非全螢幕卡片，類似書籤管理器）。
//
// 掛載於 App.vue 頂層，透過 Teleport 渲染至 <body>。狀態來源：
//   - useTeamManager()：開/合。
//   - useSavedTeamStore()：存檔清單與 save/load/pin/delete。
// 視覺沿用 ExportDialog.vue 的暗色 / clip-path 慣例。
// ============================================================

import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useTeamManager } from '@/composables/state/useTeamManager'
import { useSavedTeamStore } from '@/stores/useSavedTeamStore'
import { useDialog } from '@/composables/state/useDialog'
import { useToast } from '@/composables/state/useToast'
import { characterDisplayName } from '@/i18n'
import { useI18n } from 'vue-i18n'
import type { SavedTeam } from '@/types/savedTeam'

const { isOpen, close } = useTeamManager()
const store = useSavedTeamStore()
const { confirm } = useDialog()
const { showToast } = useToast()
const { t } = useI18n()

// ── 行內命名：另存新檔 / 建立空隊伍 共用同一個輸入列（以 saveMode 區分） ──
type SaveMode = 'saveAs' | 'create'
const isSaving = ref(false)
const saveMode = ref<SaveMode>('saveAs')
const saveName = ref('')
const saveInputRef = ref<HTMLInputElement | null>(null)

const nameTaken = computed(
  () => saveName.value.trim() !== '' && store.isNameTaken(saveName.value)
)
const canSave = computed(() => saveName.value.trim() !== '' && !nameTaken.value)

function beginSave(mode: SaveMode): void {
  saveMode.value = mode
  isSaving.value = true
  saveName.value = ''
  void nextTick(() => saveInputRef.value?.focus())
}

async function commitSave(): Promise<void> {
  if (!canSave.value) return
  if (saveMode.value === 'create') {
    // 建立空隊伍會即刻載入 → 捨棄當前工作區內容，有未存變更時先確認。
    if (store.isDirty) {
      const ok = await confirm({
        title: t('teams.discardTitle'),
        message: t('teams.discardMessage'),
        confirmText: t('teams.discardConfirm'),
        danger: true,
      })
      if (!ok) return
    }
    store.createEmptyTeam(saveName.value)
    showToast(t('teams.createdToast', { name: saveName.value.trim() }), 'success')
    cancelSave()
    close()
    return
  }
  store.saveCurrent(saveName.value)
  showToast(t('teams.savedToast', { name: saveName.value.trim() }), 'success')
  isSaving.value = false
  saveName.value = ''
}

function cancelSave(): void {
  isSaving.value = false
  saveName.value = ''
}

// ── 儲存變更：覆蓋當前綁定的存檔 ──────────────────────────────
function handleSaveToCurrent(): void {
  const team = store.currentTeam
  if (!team || !store.isDirty) return
  store.saveToCurrent()
  showToast(t('teams.savedToast', { name: team.name }), 'success')
}

// ── 每列顯示：三角色（依存檔泳道順序）＋ 軸名清單 ──────────────
function laneCharacterNames(team: SavedTeam): string[] {
  return team.laneOrder.map((si) => {
    const slot = team.slots.find((s) => s.slotIndex === si)
    return slot?.character
      ? characterDisplayName(slot.character)
      : t('sidebar.characterFallback', { n: si + 1 })
  })
}

function axisNames(team: SavedTeam): string {
  return team.axes.map((a) => a.name).join('・')
}

// ── 載入（覆蓋當前工作區；有未儲存變更時先確認） ────────────────
async function handleLoad(team: SavedTeam): Promise<void> {
  // 已是當前隊伍且無變更 → 無事可做，直接關閉。
  if (team.id === store.currentTeamId && !store.isDirty) {
    closeMenu()
    close()
    return
  }
  if (store.isDirty) {
    const ok = await confirm({
      title: t('teams.loadConfirmTitle'),
      message: t('teams.loadConfirmMessage', { name: team.name }),
      confirmText: t('teams.loadConfirm'),
      danger: true,
    })
    if (!ok) return
  }
  store.loadTeam(team.id)
  closeMenu()
  close()
}

// ── 每列「⋮」More 選單（teleport popover，仿 SettingsMenu 定位＋點外關閉） ──
const openMenuId = ref<string | null>(null)
const menuStyle = ref<Record<string, string>>({})

const openTeam = computed<SavedTeam | null>(
  () => store.sortedTeams.find((t) => t.id === openMenuId.value) ?? null
)

function toggleMenu(team: SavedTeam, event: MouseEvent): void {
  if (openMenuId.value === team.id) {
    closeMenu()
    return
  }
  const btn = event.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()
  menuStyle.value = {
    top: `${rect.bottom + 4}px`,
    right: `${window.innerWidth - rect.right}px`,
  }
  openMenuId.value = team.id
}

function closeMenu(): void {
  openMenuId.value = null
}

async function handlePin(team: SavedTeam): Promise<void> {
  store.togglePin(team.id)
  closeMenu()
}

// 以目前工作區內容覆蓋此存檔（原內容遺失，先確認）。
async function handleOverwrite(team: SavedTeam): Promise<void> {
  closeMenu()
  const ok = await confirm({
    title: t('teams.overwriteTitle'),
    message: t('teams.overwriteMessage', { name: team.name }),
    confirmText: t('teams.overwriteConfirm'),
    danger: true,
  })
  if (!ok) return
  store.overwriteTeam(team.id)
  showToast(t('teams.savedToast', { name: team.name }), 'success')
}

async function handleDelete(team: SavedTeam): Promise<void> {
  closeMenu()
  const isCurrent = team.id === store.currentTeamId
  const ok = await confirm({
    title: t('teams.deleteTitle'),
    // 刪除正在編輯的隊伍時，額外提醒使用者。
    message: isCurrent
      ? t('teams.deleteCurrentMessage', { name: team.name })
      : t('teams.deleteMessage', { name: team.name }),
    confirmText: t('teams.delete'),
    danger: true,
  })
  if (ok) store.deleteTeam(team.id)
}

// 點外關閉 More 選單（bubble 階段）。觸發鈕與選單本身皆 @click.stop，
// 其點擊不會冒泡到此 → 只有「其他區域」的點擊會關閉選單。
function onDocClick(): void {
  if (openMenuId.value !== null) closeMenu()
}

function handleClose(): void {
  closeMenu()
  cancelSave()
  close()
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <Teleport to="body">
    <Transition name="team-dialog" :duration="200">
      <div
        v-if="isOpen"
        class="team-overlay"
        @click.self="handleClose"
      >
        <div
          class="team-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="$t('teams.title')"
          @keydown.esc.prevent="handleClose"
        >
          <div class="team-dialog__head">
            <h2 class="team-dialog__title">{{ $t('teams.title') }}</h2>
            <button
              type="button"
              class="team-dialog__close"
              :aria-label="$t('teams.closeLabel')"
              @click="handleClose"
            >
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" />
              </svg>
            </button>
          </div>

          <!-- 儲存區：儲存變更（覆蓋當前隊伍）／另存新檔／建立空隊伍 -->
          <div class="team-dialog__save">
            <template v-if="!isSaving">
              <!-- 已綁定當前隊伍：顯示「儲存變更」（有未存變更才可按） -->
              <button
                v-if="store.currentTeam"
                type="button"
                class="team-dialog__save-btn team-dialog__save-btn--primary"
                :disabled="!store.isDirty"
                @click="handleSaveToCurrent"
              >
                {{ store.isDirty
                  ? $t('teams.saveChanges', { name: store.currentTeam.name })
                  : $t('teams.saved') }}
              </button>
              <div class="team-dialog__save-actions">
                <button type="button" class="team-dialog__mini-btn" @click="beginSave('saveAs')">
                  <span aria-hidden="true">＋</span> {{ $t('teams.saveAs') }}
                </button>
                <button type="button" class="team-dialog__mini-btn" @click="beginSave('create')">
                  <span aria-hidden="true">＋</span> {{ $t('teams.createEmpty') }}
                </button>
              </div>
            </template>
            <template v-else>
              <div class="team-save-row">
                <input
                  ref="saveInputRef"
                  v-model="saveName"
                  class="team-save-row__input"
                  :class="{ 'team-save-row__input--error': nameTaken }"
                  type="text"
                  :placeholder="saveMode === 'create'
                    ? $t('teams.createNamePlaceholder')
                    : $t('teams.namePlaceholder')"
                  @keydown.enter.prevent="commitSave"
                  @keydown.esc.prevent="cancelSave"
                />
                <button
                  type="button"
                  class="team-save-row__btn team-save-row__btn--confirm"
                  :disabled="!canSave"
                  @click="commitSave"
                >{{ saveMode === 'create' ? $t('teams.createConfirm') : $t('teams.saveConfirm') }}</button>
                <button
                  type="button"
                  class="team-save-row__btn"
                  @click="cancelSave"
                >{{ $t('teams.cancel') }}</button>
              </div>
              <span v-if="nameTaken" class="team-save-row__error">{{ $t('teams.nameTaken') }}</span>
            </template>
          </div>

          <!-- 清單 -->
          <div v-if="store.sortedTeams.length === 0" class="team-dialog__empty">
            {{ $t('teams.empty') }}
          </div>
          <ul v-else class="team-list">
            <li
              v-for="team in store.sortedTeams"
              :key="team.id"
              class="team-row"
              @click="handleLoad(team)"
            >
              <div class="team-row__main">
                <div class="team-row__name-line">
                  <span class="team-row__name">{{ team.name }}</span>
                  <span v-if="team.pinned" class="team-row__pin" aria-hidden="true">📌</span>
                  <span v-if="team.id === store.currentTeamId" class="team-row__editing">
                    {{ $t('teams.editingBadge') }}
                  </span>
                </div>
                <div class="team-row__chars">
                  <span
                    v-for="(name, i) in laneCharacterNames(team)"
                    :key="i"
                    class="team-row__char"
                  >{{ name }}</span>
                </div>
                <div class="team-row__axes">
                  <span class="team-row__axes-label">{{ $t('teams.axesLabel') }}</span>
                  <span class="team-row__axes-names">{{ axisNames(team) }}</span>
                </div>
              </div>

              <button
                type="button"
                class="team-row__more"
                :aria-label="$t('teams.moreLabel')"
                @click.stop="toggleMenu(team, $event)"
              >
                <svg viewBox="0 0 4 16" width="4" height="16" aria-hidden="true">
                  <circle cx="2" cy="2" r="1.6" fill="currentColor" />
                  <circle cx="2" cy="8" r="1.6" fill="currentColor" />
                  <circle cx="2" cy="14" r="1.6" fill="currentColor" />
                </svg>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- More 選單 popover（teleport 至 body，避免被 dialog overflow 裁切） -->
  <Teleport to="body">
    <div
      v-if="openTeam"
      class="team-menu"
      :style="menuStyle"
      role="menu"
      @click.stop
    >
      <button type="button" class="team-menu__item" role="menuitem" @click="handleOverwrite(openTeam)">
        {{ $t('teams.overwrite') }}
      </button>
      <button type="button" class="team-menu__item" role="menuitem" @click="handlePin(openTeam)">
        {{ openTeam.pinned ? $t('teams.unpin') : $t('teams.pin') }}
      </button>
      <div class="team-menu__divider" />
      <button type="button" class="team-menu__item team-menu__item--danger" role="menuitem" @click="handleDelete(openTeam)">
        {{ $t('teams.delete') }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.team-overlay {
  position: fixed;
  inset: 0;
  /* 低於全域 DialogHost（10000）：刪除/載入確認框須疊在本管理頁之上。 */
  z-index: 9000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 1rem 1rem;
  background-color: rgba(5, 8, 16, 0.62);
  backdrop-filter: blur(2px);
}

.team-dialog {
  width: 440px;
  max-width: 100%;
  max-height: calc(100vh - 8vh - 2rem);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1.125rem 1.25rem 1rem;
  background-color: #0D1526;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 6px;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  scrollbar-width: thin;
  scrollbar-color: rgba(34, 211, 238, 0.25) transparent;
}
.team-dialog::-webkit-scrollbar { width: 6px; }
.team-dialog::-webkit-scrollbar-thumb { background-color: rgba(34, 211, 238, 0.25); border-radius: 3px; }

.team-dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.875rem;
}
.team-dialog__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: rgba(34, 211, 238, 0.95);
  letter-spacing: 0.02em;
}
.team-dialog__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}
.team-dialog__close:hover {
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.06);
}

/* ── 儲存目前隊伍 ── */
.team-dialog__save { margin-bottom: 0.875rem; }
.team-dialog__save-btn {
  width: 100%;
  padding: 0.5rem;
  border: 1px dashed rgba(34, 211, 238, 0.45);
  border-radius: 4px;
  background: rgba(34, 211, 238, 0.05);
  color: rgba(34, 211, 238, 0.9);
  font-size: 0.8125rem;
  font-family: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.team-dialog__save-btn:hover {
  background: rgba(34, 211, 238, 0.12);
  border-color: rgba(34, 211, 238, 0.7);
}
/* 「儲存變更」主按鈕：實心邊框；無變更時淡化不可按。 */
.team-dialog__save-btn--primary {
  border-style: solid;
  margin-bottom: 0.4rem;
}
.team-dialog__save-btn--primary:disabled {
  opacity: 0.4;
  cursor: default;
}
.team-dialog__save-btn--primary:disabled:hover {
  background: rgba(34, 211, 238, 0.05);
  border-color: rgba(34, 211, 238, 0.45);
}
/* 另存新檔 / 建立空隊伍：並列的次要小按鈕。 */
.team-dialog__save-actions { display: flex; gap: 0.4rem; }
.team-dialog__mini-btn {
  flex: 1;
  padding: 0.4rem;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  color: rgba(240, 244, 248, 0.7);
  font-size: 0.75rem;
  font-family: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.team-dialog__mini-btn:hover {
  background: rgba(34, 211, 238, 0.08);
  border-color: rgba(34, 211, 238, 0.4);
  color: rgba(34, 211, 238, 0.9);
}
.team-save-row { display: flex; gap: 0.4rem; }
.team-save-row__input {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.625rem;
  background-color: #0A0F1E;
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 4px;
  color: rgba(240, 244, 248, 0.95);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
}
.team-save-row__input:focus { border-color: rgba(34, 211, 238, 0.7); }
.team-save-row__input--error { border-color: rgba(248, 113, 113, 0.7); }
.team-save-row__btn {
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background-color: #131b2e;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.8125rem;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.team-save-row__btn:hover { background-color: #1b2740; color: rgba(255, 255, 255, 0.92); }
.team-save-row__btn--confirm { border-color: rgba(34, 211, 238, 0.45); color: rgba(34, 211, 238, 0.95); }
.team-save-row__btn--confirm:hover { background-color: rgba(34, 211, 238, 0.14); }
.team-save-row__btn:disabled { opacity: 0.4; cursor: not-allowed; }
.team-save-row__error {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.6875rem;
  color: rgba(248, 113, 113, 0.9);
}

/* ── 清單 ── */
.team-dialog__empty {
  padding: 2rem 0;
  text-align: center;
  font-size: 0.8125rem;
  color: rgba(240, 244, 248, 0.35);
}
.team-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.team-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.team-row:hover {
  background: rgba(34, 211, 238, 0.06);
  border-color: rgba(34, 211, 238, 0.3);
}
.team-row__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.team-row__name-line { display: flex; align-items: center; gap: 0.35rem; }
.team-row__pin { font-size: 0.75rem; }
.team-row__editing {
  flex-shrink: 0;
  padding: 0.05rem 0.35rem;
  border-radius: 99px;
  background: rgba(34, 211, 238, 0.16);
  border: 1px solid rgba(34, 211, 238, 0.4);
  color: rgba(34, 211, 238, 0.95);
  font-size: 0.625rem;
  letter-spacing: 0.04em;
}
.team-row__name {
  font-size: 0.8125rem;
  font-weight: 700;
  color: rgba(245, 249, 252, 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-row__chars { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.team-row__char {
  font-size: 0.6875rem;
  padding: 0.1rem 0.4rem;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(240, 244, 248, 0.72);
}
.team-row__axes { display: flex; align-items: baseline; gap: 0.4rem; font-size: 0.6875rem; }
.team-row__axes-label {
  flex-shrink: 0;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}
.team-row__axes-names {
  color: rgba(240, 244, 248, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-row__more {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.75rem;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.team-row__more:hover { color: rgba(255, 255, 255, 0.95); background: rgba(255, 255, 255, 0.08); }

/* ── More popover ── */
.team-menu {
  position: fixed;
  /* 高於管理頁本體（9000）、低於全域 DialogHost（10000）。 */
  z-index: 9001;
  min-width: 8rem;
  padding: 0.25rem;
  background-color: #0D1526;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}
.team-menu__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.45rem 0.6rem;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: rgba(240, 244, 248, 0.85);
  font-size: 0.8125rem;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.team-menu__item:hover { background: rgba(255, 255, 255, 0.08); }
.team-menu__item--danger { color: rgba(248, 113, 113, 0.9); }
.team-menu__item--danger:hover { background: rgba(248, 113, 113, 0.14); color: #f87171; }
.team-menu__divider { height: 1px; margin: 0.25rem 0.3rem; background: rgba(255, 255, 255, 0.08); }

/* ── 進出場動畫（沿用 export-dialog 慣例） ── */
.team-dialog-enter-active { transition: opacity 0.18s ease; }
.team-dialog-leave-active { transition: opacity 0.14s ease; }
.team-dialog-enter-from, .team-dialog-leave-to { opacity: 0; }
.team-dialog-enter-active .team-dialog { transition: transform 0.2s cubic-bezier(0.34, 1.26, 0.64, 1); }
.team-dialog-enter-from .team-dialog { transform: translateY(10px) scale(0.97); }

@media (prefers-reduced-motion: reduce) {
  .team-dialog-enter-active,
  .team-dialog-leave-active,
  .team-dialog-enter-active .team-dialog { transition: opacity 0.12s ease; }
  .team-dialog-enter-from .team-dialog { transform: none; }
}
</style>

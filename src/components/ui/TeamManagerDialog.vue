<script setup lang="ts">
// ============================================================
// TeamManagerDialog.vue — 隊伍管理浮層（非全螢幕卡片，類似書籤管理器）。
//
// 掛載於 App.vue 頂層，透過 Teleport 渲染至 <body>。狀態來源：
//   - useTeamManager()：開/合。
//   - useSavedTeamStore()：存檔清單與 save/load/pin/delete。
// 視覺沿用 ExportDialog.vue 的暗色 / clip-path 慣例。
// ============================================================

import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useDraggable } from 'vue-draggable-plus'
import { useTeamManager } from '@/composables/state/useTeamManager'
import { useSavedTeamStore } from '@/stores/useSavedTeamStore'
import { useDialog } from '@/composables/state/useDialog'
import { useToast } from '@/composables/state/useToast'
import { characterDisplayName } from '@/i18n'
import { getElementColor } from '@/constants/elements'
import { useI18n } from 'vue-i18n'
import type { SavedTeam } from '@/types/savedTeam'

const { isOpen, saveAsRequested, close } = useTeamManager()
const store = useSavedTeamStore()
const { confirm, prompt } = useDialog()
const { showToast } = useToast()
const { t } = useI18n()

// ── 行內命名：另存新檔的名稱輸入列 ──────────────────────────
const isSaving = ref(false)
const saveName = ref('')
const saveInputRef = ref<HTMLInputElement | null>(null)

const nameTaken = computed(
  () => saveName.value.trim() !== '' && store.isNameTaken(saveName.value)
)
const canSave = computed(() => saveName.value.trim() !== '' && !nameTaken.value)

function beginSave(): void {
  isSaving.value = true
  saveName.value = ''
  void nextTick(() => saveInputRef.value?.focus())
}

function commitSave(): void {
  if (!canSave.value) return
  store.saveCurrent(saveName.value)
  showToast(t('teams.savedToast', { name: saveName.value.trim() }), 'success')
  isSaving.value = false
  saveName.value = ''
}

function cancelSave(): void {
  isSaving.value = false
  saveName.value = ''
}

// Ctrl+Shift+S 開啟管理頁時直接進入另存命名（消費旗標後清除）。
watch(isOpen, (open) => {
  if (open && saveAsRequested.value) {
    saveAsRequested.value = false
    beginSave()
  }
})

// ── 建立空隊伍：免命名，直接重置工作區進入自由模式 ──────────────
async function handleCreateEmpty(): Promise<void> {
  // 重置會捨棄當前工作區內容，有未存變更時先確認。
  if (store.isDirty) {
    const ok = await confirm({
      title: t('teams.discardTitle'),
      message: t('teams.discardMessage'),
      confirmText: t('teams.discardConfirm'),
      danger: true,
    })
    if (!ok) return
  }
  store.createEmptyWorkspace()
  showToast(t('teams.createdToast'), 'success')
  close()
}

// ── 儲存變更：覆蓋當前綁定的存檔 ──────────────────────────────
function handleSaveToCurrent(): void {
  const team = store.currentTeam
  if (!team || !store.isDirty) return
  store.saveToCurrent()
  showToast(t('teams.savedToast', { name: team.name }), 'success')
}

// ── 每列顯示：已選角色（依存檔泳道順序、空位略過）＋ 軸名清單 ────
interface CharChip {
  name: string
  color: string // 屬性代表色（文字著色 + 邊框淡色）
}
function laneCharacterChips(team: SavedTeam): CharChip[] {
  return team.laneOrder
    .map((si) => team.slots.find((s) => s.slotIndex === si)?.character ?? null)
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map((c) => ({
      name: characterDisplayName(c),
      color: getElementColor(c.element),
    }))
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
// 「覆蓋當前正在編輯的隊伍」＝與上方「儲存變更」等價 → 選單中該項禁用（見 template），
// 此處防禦性再擋一次，避免自我覆蓋。
async function handleOverwrite(team: SavedTeam): Promise<void> {
  if (team.id === store.currentTeamId) return
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

// 改名此存檔：以 prompt 取新名，交由 store 驗證（空白/重名則忽略並提示）。
async function handleRename(team: SavedTeam): Promise<void> {
  closeMenu()
  const name = await prompt({
    title: t('teams.renameTitle'),
    defaultValue: team.name,
    placeholder: t('teams.namePlaceholder'),
    confirmText: t('teams.saveConfirm'),
  })
  if (name == null) return
  const trimmed = name.trim()
  if (trimmed === '' || trimmed === team.name) return
  if (store.isNameTaken(trimmed, team.id)) {
    showToast(t('teams.nameTaken'), 'warning')
    return
  }
  store.renameTeam(team.id, trimmed)
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

// ── 未置頂項的自由拖曳排序（比照泳道把手；置頂項把手禁用、不可拖） ──────────────
// 清單容器 DOM 參照：僅在有存檔時渲染（v-else），初始可能為 null。
const listRef = ref<HTMLElement | null>(null)

// SortableJS 設定（兩參數／不受管形式）：落地時先還原 DOM，再交回 store 依資料重繪，
// 維持「單一真相＝store」的慣例（同 Swimlane 泳道拖曳），避免 v-for 與套件互搶 DOM。
const dragOptions = computed(
  (): Record<string, unknown> => ({
    immediate: false,
    handle: '.team-row__drag',
    draggable: '.team-row',
    // 置頂項不可作為拖曳來源（其把手另以樣式呈現禁用灰）。
    filter: '.team-row--pinned',
    animation: 150,
    // 阻止未置頂項被拖入置頂區段（置頂永遠在最上）。
    onMove: (evt: { related: HTMLElement }) =>
      !evt.related.classList.contains('team-row--pinned'),
    onEnd: handleReorderEnd,
  })
)

const { start: startDraggable, destroy: destroyDraggable } = useDraggable(listRef, dragOptions)

// 清單容器出現／消失時掛上／銷毀拖曳實例。
watch(listRef, (el) => {
  if (el) startDraggable(el)
  else destroyDraggable()
})

/** 拖曳落地：先把 SortableJS 對 DOM 的移動還原，再由 store 依新順序重排（Vue 重繪）。 */
function handleReorderEnd(evt: { item: HTMLElement; from: HTMLElement; oldIndex?: number; newIndex?: number }): void {
  const { oldIndex, newIndex, item, from } = evt
  if (oldIndex == null || newIndex == null || oldIndex === newIndex) return
  // 還原：把被拖節點移回原位（移除後依原索引插回），讓 Vue 保持 DOM 唯一真相。
  item.remove()
  from.insertBefore(item, from.children[oldIndex] ?? null)
  store.reorderTeams(oldIndex, newIndex)
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  destroyDraggable()
})
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
                <button type="button" class="team-dialog__mini-btn" @click="beginSave()">
                  <span aria-hidden="true">＋</span> {{ $t('teams.saveAs') }}
                </button>
                <button type="button" class="team-dialog__mini-btn" @click="handleCreateEmpty">
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
                  :placeholder="$t('teams.namePlaceholder')"
                  @keydown.enter.prevent="commitSave"
                  @keydown.esc.prevent="cancelSave"
                />
                <button
                  type="button"
                  class="team-save-row__btn team-save-row__btn--confirm"
                  :disabled="!canSave"
                  @click="commitSave"
                >{{ $t('teams.saveConfirm') }}</button>
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
          <ul v-else ref="listRef" class="team-list">
            <li
              v-for="team in store.sortedTeams"
              :key="team.id"
              class="team-row"
              :class="{
                'team-row--pinned': team.pinned,
                'team-row--editing': team.id === store.currentTeamId,
              }"
              @click="handleLoad(team)"
            >
              <!-- 拖曳把手：未置頂項可拖曳排序；置頂項顯示禁用灰把手（不可拖）。 -->
              <span
                class="team-row__drag"
                :class="{ 'team-row__drag--disabled': team.pinned }"
                :aria-label="team.pinned ? $t('teams.dragPinned') : $t('teams.dragReorder')"
                :title="team.pinned ? $t('teams.dragPinned') : $t('teams.dragReorder')"
                @click.stop
              >
                <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
                  <circle cx="2.5" cy="3" r="1.1" fill="currentColor" />
                  <circle cx="7.5" cy="3" r="1.1" fill="currentColor" />
                  <circle cx="2.5" cy="8" r="1.1" fill="currentColor" />
                  <circle cx="7.5" cy="8" r="1.1" fill="currentColor" />
                  <circle cx="2.5" cy="13" r="1.1" fill="currentColor" />
                  <circle cx="7.5" cy="13" r="1.1" fill="currentColor" />
                </svg>
              </span>
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
                    v-for="(chip, i) in laneCharacterChips(team)"
                    :key="i"
                    class="team-row__char"
                    :style="{ color: chip.color, borderColor: chip.color + '4D' }"
                  >{{ chip.name }}</span>
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
      <button
        type="button"
        class="team-menu__item"
        role="menuitem"
        :disabled="openTeam.id === store.currentTeamId"
        @click="handleOverwrite(openTeam)"
      >
        {{ $t('teams.overwrite') }}
      </button>
      <button type="button" class="team-menu__item" role="menuitem" @click="handleRename(openTeam)">
        {{ $t('teams.rename') }}
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
  font-family: var(--app-font-mono, 'JetBrains Mono', 'Fira Code', ui-monospace, monospace);
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
/* 正在編輯（＝當前綁定）的隊伍：淡金色描邊環。用 box-shadow 而非 border-color，
   使其在 hover 改動 border-color 時仍保留（不被覆蓋）。 */
.team-row--editing {
  border-color: rgba(212, 175, 55, 0.55);
  box-shadow: inset 0 0 0 1px rgba(212, 175, 55, 0.45), 0 0 8px rgba(212, 175, 55, 0.12);
}
.team-row--editing:hover {
  border-color: rgba(212, 175, 55, 0.75);
}
/* 拖曳把手：未置頂項可抓握（grab）；置頂項顯示禁用灰、不可拖。 */
.team-row__drag {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 0.875rem;
  align-self: stretch;
  color: rgba(255, 255, 255, 0.4);
  cursor: grab;
  transition: color 0.15s ease;
}
.team-row__drag:hover { color: rgba(34, 211, 238, 0.85); }
.team-row__drag:active { cursor: grabbing; }
.team-row__drag--disabled {
  color: rgba(255, 255, 255, 0.16);
  cursor: not-allowed;
  pointer-events: none;
}
/* 拖曳中的浮動分身（SortableJS 掛於清單容器）。 */
.team-list :deep(.sortable-ghost) { opacity: 0.4; }
.team-list :deep(.sortable-drag) { opacity: 0.95; }
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
  font-size: 0.9375rem;
  font-weight: 700;
  color: rgba(245, 249, 252, 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-row__chars { display: flex; flex-wrap: wrap; gap: 0.3rem; }
/* 角色名以屬性代表色著色（color/borderColor 由行內樣式注入）；
   無底色、僅留淡色描邊；整體降透明度使其在卡片上更為內斂。 */
.team-row__char {
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 99px;
  border: 1px solid transparent;
  background: transparent;
  opacity: 0.8;
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
  font-family: var(--app-font-mono, 'JetBrains Mono', 'Fira Code', ui-monospace, monospace);
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
/* 禁用項（如「覆蓋」指向當前正在編輯的隊伍＝與儲存變更等價）：淡化且不可點。 */
.team-menu__item:disabled { opacity: 0.35; cursor: not-allowed; }
.team-menu__item:disabled:hover { background: transparent; }
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

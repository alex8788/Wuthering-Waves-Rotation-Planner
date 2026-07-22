<script setup lang="ts">
// ============================================================
// AppHeader.vue
// 頂部導覽列。左側顯示品牌標題「鳴潮排軸編輯器」，其下改以「當前隊伍名稱」
// 取代原本的固定 eyebrow：綁定存檔時顯示隊伍名，可雙擊就地改名；
// 自由模式（未綁定存檔）則顯示「隊伍未存檔」的特殊淡化樣式，且不可改名。
//
// 未儲存提示（isDirty）：綁定存檔且有未存變更時，名稱後綴黃色星號「*」，
// 儲存為最新版後移除；自由模式且工作區有內容時，未存檔字樣改黃色警示並加括號。
//
// 狀態來源：useSavedTeamStore（currentTeam 綁定 + renameTeam 改名 + isDirty）。
// 右側保留 actions slot 供功能按鈕（隊伍/匯出/說明）擴充。
// ============================================================
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSavedTeamStore } from '@/stores/useSavedTeamStore'
import { useToast } from '@/composables/state/useToast'
import { useHotkeyInputMode } from '@/composables/state/useHotkeyInputMode'

const store = useSavedTeamStore()
const { t } = useI18n()
const { showToast } = useToast()
const hotkeyMode = useHotkeyInputMode()

// 熱鍵輸入模式中點擊頂列按鈕（隊伍/匯出/設定/說明等）：視同失焦，暫停接收輸入，
// 避免操作標題列或其開啟的浮層時，按鍵誤落入軸面。回焦（點回軸面覆蓋層或視窗 focus）即恢復。
function pauseModeOnHeaderInteraction(): void {
  if (hotkeyMode.active.value) hotkeyMode.pause()
}

// 當前綁定的隊伍（自由模式為 null）。
const currentTeam = computed(() => store.currentTeam)

// ── 就地改名狀態 ────────────────────────────────────────────
const isRenaming = ref(false)
const draftName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 雙擊隊伍名進入改名（僅綁定存檔時可用）。
function beginRename(): void {
  const team = currentTeam.value
  if (!team) return
  draftName.value = team.name
  isRenaming.value = true
  void nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

// 送出改名：交由 store 驗證（空白/重名則忽略並提示）。
function commitRename(): void {
  const team = currentTeam.value
  if (!team) {
    isRenaming.value = false
    return
  }
  const trimmed = draftName.value.trim()
  // 名稱未變或空白 → 直接結束，不動存檔。
  if (trimmed === '' || trimmed === team.name) {
    isRenaming.value = false
    return
  }
  if (store.isNameTaken(trimmed, team.id)) {
    showToast(t('teams.nameTaken'), 'warning')
    return
  }
  store.renameTeam(team.id, trimmed)
  isRenaming.value = false
}

function cancelRename(): void {
  isRenaming.value = false
}
</script>

<template>
  <header class="app-header">
    <div class="app-header__brand">
      <span class="app-header__brand-icon" aria-hidden="true">
        <img src="/Phoebe.svg" alt="" draggable="false" />
      </span>
      <span class="app-header__divider" aria-hidden="true" />

      <div class="app-header__titles">
        <h1 class="app-header__title">{{ $t('header.title') }}</h1>

        <!-- 當前隊伍名稱：綁定存檔顯示名稱（雙擊改名）；自由模式顯示未存檔樣式 -->
        <input
          v-if="isRenaming"
          ref="inputRef"
          v-model="draftName"
          class="app-header__team-input"
          type="text"
          :placeholder="$t('teams.namePlaceholder')"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <span
          v-else-if="currentTeam"
          class="app-header__team"
          :title="$t('teams.renameTooltip')"
          @dblclick="beginRename"
        >{{ currentTeam.name }}<!--
          未儲存變更時，於隊伍名後綴黃色星號；儲存為最新版後消失。
        --><span v-if="store.isDirty" class="app-header__dirty-mark" aria-hidden="true">*</span></span>
        <span
          v-else
          class="app-header__team app-header__team--unsaved"
          :class="{ 'app-header__team--unsaved-dirty': store.isDirty }"
        >{{ store.isDirty ? `（${$t('teams.unsaved')}）` : $t('teams.unsaved') }}</span>
      </div>
    </div>

    <div class="app-header__actions" @pointerdown="pauseModeOnHeaderInteraction">
      <slot name="actions" />
    </div>

    <div class="app-header__glow-line" aria-hidden="true" />
  </header>
</template>

<style scoped>
.app-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 0 1.5rem;
  background-color: #0A0F1E;
  font-family: var(--app-font-mono, 'JetBrains Mono', 'Fira Code', ui-monospace, monospace);
}

/* ── 左側品牌區 ─────────────────────────────────────────── */
.app-header__brand {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}

/* 品牌圖示：取代原呼吸燈，顯示指定圖片。
   固定 36×36 顯示框 + overflow:hidden 作為裁切容器；
   內層圖片以 transform: scale 放大，把圖檔本身四周的透明空白裁掉，
   讓實際畫面填滿整個框。放大倍率與位移可視圖檔留白量微調。 */
.app-header__brand-icon {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  overflow: hidden;
  border-radius: 6px;
  user-select: none;
}

.app-header__brand-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* 放大以裁掉透明留白；1 = 不裁切，數字越大裁越多。 */
  transform: scale(1.4);
}

/* 細線分隔：上下漸隱，避免死板的純色直線 */
.app-header__divider {
  flex-shrink: 0;
  width: 1px;
  height: 1.5rem;
  background: linear-gradient(
    to bottom,
    transparent,
    rgba(34, 211, 238, 0.45),
    transparent
  );
}

.app-header__titles {
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  min-width: 0;
}

.app-header__title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(240, 244, 248, 0.95);
  white-space: nowrap;
}

/* 當前隊伍名稱：呼應科幻 HUD 排版；雙擊可就地改名。 */
.app-header__team {
  max-width: 22ch;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: rgba(34, 211, 238, 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
}

/* 自由模式：未綁定存檔，改以淡化的中性色 + 斜體標示「未存檔」。 */
.app-header__team--unsaved {
  color: rgba(240, 244, 248, 0.4);
  font-style: italic;
  letter-spacing: 0.1em;
}
/* 自由模式且工作區有未存內容：改以黃色警示色，強調有內容尚未存檔。 */
.app-header__team--unsaved-dirty {
  color: rgba(250, 204, 21, 0.85);
}

/* 未儲存星號：綁定存檔時附於名稱後的黃色 '*'，儲存為最新版後移除。 */
.app-header__dirty-mark {
  margin-left: 0.15em;
  color: rgba(250, 204, 21, 0.95);
  font-weight: 700;
}

/* 就地改名輸入框：沿用青色系，貼齊名稱位置以求視覺連續。 */
.app-header__team-input {
  max-width: 22ch;
  padding: 0.05rem 0.25rem;
  background-color: #0A0F1E;
  border: 1px solid rgba(34, 211, 238, 0.5);
  border-radius: 3px;
  color: rgba(240, 244, 248, 0.95);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  font-family: inherit;
  outline: none;
}
.app-header__team-input:focus { border-color: rgba(34, 211, 238, 0.85); }

/* ── 右側動作區（保留擴充） ───────────────────────────────── */
.app-header__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* ── 底部發光細線：與主內容區的視覺分隔 ──────────────────────── */
.app-header__glow-line {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent 0%,
    rgba(34, 211, 238, 0.55) 18%,
    rgba(34, 211, 238, 0.15) 50%,
    transparent 100%
  );
}

</style>

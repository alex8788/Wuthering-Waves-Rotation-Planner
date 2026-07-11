<script setup lang="ts">
// Swimlane.vue — 單一角色的橫向時間軸軌道。
//
// 設計原則：
//   - useDraggable 兩參數形式：只掛拖曳偵測，不把清單交給套件受管（避免其
//     replaceChild 擾動 DOM）。單一真相流：handleDragEnd → store → watch → 重渲染。
//   - localEntries 為緩衝陣列，避免套件直接改唯讀 props 導致 VDOM 脫鉤。

import { ref, computed, watch, nextTick } from 'vue'
import { useDraggable } from 'vue-draggable-plus'
import RotationBlock from '@/components/rotation/RotationBlock.vue'
import CharacterSelector from '@/components/character/CharacterSelector.vue'
import { useRotationStore } from '@/stores/useRotationStore'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useBlockDrag, DROP_ZONE_ATTRIBUTE, type SortableEventLike } from '@/composables/useBlockDrag'
import { useHistory } from '@/composables/state/useHistory'
import { useDialog } from '@/composables/state/useDialog'
import { getElementColor } from '@/constants/elements'
import { useSettings } from '@/composables/state/useSettings'
import { useI18n } from 'vue-i18n'
import { characterDisplayName } from '@/i18n'
import type { Character } from '@/types/character'
import type { RotationEntry } from '@/types/rotation'

// ── Props ────────────────────────────────────────────────────

interface Props {
  /** 此泳道對應的角色 (null 代表未選角) */
  character: Character | null
  /** 槽位索引 (0 / 1 / 2) */
  slotIndex: 0 | 1 | 2
  /** 父層過濾後的區塊序列 (唯讀真相來源) */
  entries: RotationEntry[]
  /** 三條泳道共用的 grid-template-columns（拖曳時為含落點空欄的預覽版） */
  gridTemplate: string
  /** entryId → 全域 0-based 欄位序，供 grid-column 定位（拖曳時為預覽版） */
  idToColumnIndex: Map<string, number>
  /** 落點空欄的 0-based 欄序（拖曳預覽用，null = 無落點） */
  placeholderColumn: number | null
  /** 落點所在泳道（只有此泳道畫單欄虛框） */
  previewSlotIndex: 0 | 1 | 2 | null
  /** 泳道拖曳中且本泳道為來源 → 原位顯示為留空佔位 */
  draggingAsSource?: boolean
}

const props = defineProps<Props>()

// 泳道拖曳：把手按下時通知父層（RotationBoard）啟動自製垂直 reorder。
// 帶上原生 MouseEvent 供父層取得起始游標座標。
const emit = defineEmits<{
  (e: 'lane-drag-start', payload: { slotIndex: 0 | 1 | 2; event: MouseEvent }): void
}>()

function handleLaneDragStart(event: MouseEvent): void {
  // 阻止冒泡到 window：避免觸發 RotationBoard 的框選 marquee；並停掉文字選取。
  event.stopPropagation()
  event.preventDefault()
  emit('lane-drag-start', { slotIndex: props.slotIndex, event })
}

// ── Store / Composable ──────────────────────────────────────

const rotationStore = useRotationStore()
const characterStore = useCharacterStore()
const history = useHistory()
const { confirm } = useDialog()
const {
  dragState,
  onRotationDragStart,
  handleDragEnd,
  getRotationSortableOptions,
} = useBlockDrag()

// 本泳道統一顏色＝角色屬性色（同屬性 header 色條/區塊顏色完全一致）。未選角給中性色。
const laneColor = computed<string>(() => getElementColor(props.character?.element ?? null))

// 區塊間距（px）：讀設定 trackGapPx（單一來源），注入 --track-gap。
const { settings } = useSettings()
const trackGapPx = computed<number>(() => settings.value.trackGapPx)

const { t } = useI18n()
// 角色顯示名（依語言 nameZh/nameEn），模板與 aria 共用。
const charName = computed<string>(() => characterDisplayName(props.character))

// VueDraggable 操作的本地緩衝陣列，防止套件直接修改 prop 導致資料流脫鉤
const localEntries = ref<RotationEntry[]>([...props.entries])

// 當 store 更新導致 props.entries 改變時，同步校正緩衝陣列
watch(
  () => props.entries,
  (newEntries) => {
    localEntries.value = [...newEntries]
  }
)

// 可拖曳容器 DOM 參照：useDraggable 把 SortableJS 掛在這個元素上（取代 <VueDraggable>）。
const trackEl = ref<HTMLElement | null>(null)

// SortableJS 設定。兩參數形式不交出清單（見檔頭原則）：若交管，套件會在原地放開
// 時 replaceChild 還原 DOM，擾動子節點使尾端 ＋按鈕 v-show 與 vdom 脫鉤（卡 display:none）。
const dragOptions = computed(
  (): Record<string, unknown> => ({
    ...getRotationSortableOptions(props.slotIndex),
    // 容器只在「已選角」時渲染（v-else 內），trackEl 初始為 null；關閉自動初始化，
    // 改由下方 watch 在容器出現時手動 start，避免 SortableJS 收到 null 於 mounted 拋例外。
    immediate: false,
    onStart: handleDragStart,
    onEnd: handleEnd,
  })
)

// 兩參數形式：只掛拖曳行為，不交出清單管理權（見上方註解）。
const { start: startDraggable, destroy: destroyDraggable } = useDraggable(trackEl, dragOptions)

// 容器隨「選角/清空」動態出現或消失：出現時掛上拖曳、消失時銷毀，避免持有脫離 DOM 的實例。
watch(trackEl, (el) => {
  if (el) startDraggable(el)
  else destroyDraggable()
})

// 每個區塊的定位樣式：
//  - 被拖本體：隱藏並抽離 grid flow（forceFallback 分身在跟手；落點由預覽空欄表示）。
//  - 其餘：依（預覽版）欄序釘 grid-column；拿不到欄序則隱藏（保險）。
function blockStyle(id: string): Record<string, string> {
  // 被拖區塊（多選＝整組）一律隱藏並抽離 grid flow；落點由共用預覽空欄表示。
  if (dragState.isDragging && (id === dragState.draggingId || dragState.draggingIds.includes(id))) {
    return { visibility: 'hidden', position: 'absolute', pointerEvents: 'none' }
  }
  const col = props.idToColumnIndex.get(id)
  return col != null ? { gridColumn: String(col + 1) } : { display: 'none' }
}

// 反查被拖區塊對應的 entry。優先用被拖 DOM 的 data-entry-id 直接比對（最穩；
// 不受 grid 內裝飾節點＋按鈕/落點虛框影響 SortableJS 索引而對不到 → 抓不起來）。
// 退而求其次才用事件索引。
function getEntryFromDragEvent(event: SortableEventLike): RotationEntry | undefined {
  const id = event.item?.getAttribute?.('data-entry-id')
  if (id) {
    const byId = localEntries.value.find((e) => e.id === id)
    if (byId) return byId
  }
  const localIndex = event.oldDraggableIndex ?? event.oldIndex ?? -1
  return localEntries.value[localIndex]
}

// ── 事件處理 ──────────────────────────────────────────────────

// 拖曳起點：記錄本泳道既有區塊的起點，並量被拖 DOM 寬度作為落點空欄寬
function handleDragStart(event: SortableEventLike): void {
  const entry = getEntryFromDragEvent(event)
  if (!entry) return
  const width = event.item?.getBoundingClientRect().width ?? 0
  onRotationDragStart(entry, width)
}

// 拖曳結束：所有落地（側邊欄拖入、同泳道重排、跨泳道）統一在此處理，
// 不綁 onAdd/onUpdate（其 index 在跨全域排序時不可靠，見 useBlockDrag）。
function handleEnd(event: SortableEventLike): void {
  handleDragEnd(event)
}

// 區塊點擊選取 (支援 Ctrl/Meta 多選)
function handleBlockSelect(entryId: string, event: MouseEvent): void {
  const isMultiSelect = event.ctrlKey || event.metaKey
  rotationStore.selectBlock(entryId, isMultiSelect)
}

// 註：拖曳到可刪除區的紅色警告，改由 useBlockDrag 在 <body> 掛全域 class、
// 純 CSS 直接套在 SortableJS 浮動克隆 .sortable-fallback 上（forceFallback 下
// 響應式 prop 無法作用於靜態克隆），故此處不再逐塊計算 danger 狀態。

// ── 既有邏輯 ──────────────────────────────────────────────────

// ＋ 按鈕在共用 grid 內的 0-based 欄序：該泳道自己最後一個區塊的欄序 + 1
// （落在其後一欄，而非整條 grid 末端）。空泳道 → 第 0 欄（靠左）。
// 用（非預覽版）欄序即可，因拖曳預覽期間 ＋ 會隱藏。
const addButtonColumn = computed<number>(() => {
  let lastCol = -1
  for (const entry of localEntries.value) {
    const col = props.idToColumnIndex.get(entry.id)
    if (col != null && col > lastCol) lastCol = col
  }
  return lastCol + 1
})

// 定位本泳道最後一個區塊的全局索引；若為空則回傳全局末尾
const insertAfterIndex = computed<number>(() => {
  const globalEntries = rotationStore.entries
  for (let i = globalEntries.length - 1; i >= 0; i--) {
    if (globalEntries[i].slotIndex === props.slotIndex) {
      return i
    }
  }
  return globalEntries.length - 1
})

// 行內編輯狀態集中於 rotationStore（editingId/editingDraft），讓 RotationBoard
// 的量測列能即時讀到草稿、據以即時重算欄寬。本泳道只負責觸發與轉發。

// 於本泳道末尾新增空白實體區塊，並立即進入行內編輯讓使用者輸入 label
function handleAddBlock(): void {
  if (!props.character) return
  // 開啟交易：新增＋首次命名（或放棄）合併為單一可復原步驟（見 useHistory）。
  history.beginPending()
  const newId = rotationStore.addFreeformBlock(
    '',
    laneColor.value,
    props.slotIndex,
    props.character.id,
    insertAfterIndex.value,
  )
  // 等 watch 把新區塊渲染進 localEntries 後再標記編輯（RotationBlock 會自動聚焦）
  void nextTick(() => {
    rotationStore.startEditing(newId)
  })
}

// 雙擊區塊 → 進入編輯
function handleRequestEdit(entryId: string): void {
  rotationStore.startEditing(entryId)
}

// 提交：寫入 store（空字串由 store.updateLabel 處理為刪除），結束編輯。
// 若有進行中的新增交易：命名成功 → 提交成一步；命名為空（被刪）→ 整筆丟棄不留歷史。
// （雙擊既有區塊的再編輯無交易，commit/cancelPending 皆為 no-op，由 updateLabel 自行記一步。）
function handleCommitLabel(entryId: string, label: string): void {
  rotationStore.updateLabel(entryId, label)
  if (label.trim() === '') history.cancelPending()
  else history.commitPending()
  if (rotationStore.editingId === entryId) rotationStore.stopEditing()
}

// 取消：不動 store，結束編輯。若是剛新增的空白區塊（label 仍為空），順手刪除避免殘留空塊。
// 取消一律丟棄進行中交易（既有區塊再編輯無交易則為 no-op）。
function handleCancelEdit(entryId: string): void {
  const entry = rotationStore.entries.find((e) => e.id === entryId)
  if (entry && entry.block.label.trim() === '') {
    rotationStore.deleteBlock(entryId)
  }
  history.cancelPending()
  if (rotationStore.editingId === entryId) rotationStore.stopEditing()
}

// 點擊軌道空白處時清除全域選取
function handleTrackClick(): void {
  rotationStore.clearSelection()
}

// header 選擇器變更角色 → 換角色＝跨所有輸出軸重開連招，故先清空所有軸該泳道。
// 若該泳道在任一軸尚有區塊，先彈警告確認；取消則不換角色（選單因受控自動回退）。
async function handleSelectCharacter(characterId: string): Promise<void> {
  if (props.character?.id === characterId) return

  const hasBlocks = rotationStore.axes.some((axis) =>
    axis.entries.some((entry) => entry.slotIndex === props.slotIndex)
  )
  if (hasBlocks) {
    const ok = await confirm({
      title: t('swimlane.switchTitle'),
      message: t('swimlane.switchMessage'),
      confirmText: t('swimlane.switchConfirm'),
      danger: true,
    })
    if (!ok) return
  }

  // clearSlot 與 setCharacter 為連續同步呼叫（await 後仍同一批次），
  // microtask 合併為單一可復原步驟 → 一次 Undo 同時還原所有軸區塊與角色。
  rotationStore.clearSlot(props.slotIndex)
  characterStore.setCharacter(props.slotIndex, characterId)
}

// 取消選角：清空該泳道所有軸的區塊，並把角色重設為未選（null）。
// 讓輸出軸可只用單人或雙人（空泳道呈現「請先選擇角色」提示）。
// 有區塊時先確認；clearSlot + setCharacter(null) 同批次合併為單一可復原步驟。
async function handleDeselectCharacter(): Promise<void> {
  if (!props.character) return

  const hasBlocks = rotationStore.axes.some((axis) =>
    axis.entries.some((entry) => entry.slotIndex === props.slotIndex)
  )
  if (hasBlocks) {
    const ok = await confirm({
      title: t('swimlane.deselect'),
      message: t('swimlane.deselectMessage'),
      confirmText: t('swimlane.deselect'),
      danger: true,
    })
    if (!ok) return
  }

  rotationStore.clearSlot(props.slotIndex)
  characterStore.setCharacter(props.slotIndex, null)
}
</script>

<template>
  <div
    class="swimlane"
    :class="[`swimlane--slot-${slotIndex}`, { 'swimlane--drag-source': draggingAsSource }]"
    :style="{ '--track-gap': `${trackGapPx}px` }"
    :[DROP_ZONE_ATTRIBUTE]="true"
    :data-slot-index="slotIndex"
    :aria-label="character ? $t('swimlane.laneOf', { name: charName }) : $t('swimlane.laneEmpty', { n: slotIndex + 1 })"
  >

    <div
      class="swimlane__header"
      :class="{ 'swimlane__header--drag-inert': dragState.isDragging }"
      :style="{ '--lane-color': laneColor }"
      :data-tour="slotIndex === 0 ? 'lane-header' : undefined"
      aria-hidden="false"
    >
      <!-- 左側垂直色條：屬性色識別（未選角為灰）。 -->
      <div
        class="header__color-bar"
        :style="{ backgroundColor: character ? laneColor : 'rgba(255,255,255,0.15)' }"
        aria-hidden="true"
      />

      <!-- 泳道拖曳把手：色條之後、垂直置中。 -->
      <button
        class="header__drag-handle"
        type="button"
        :aria-label="$t('swimlane.dragLane')"
        :title="$t('swimlane.dragLane')"
        @mousedown="handleLaneDragStart"
      >
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
          <circle cx="2.5" cy="3" r="1.1" fill="currentColor" />
          <circle cx="7.5" cy="3" r="1.1" fill="currentColor" />
          <circle cx="2.5" cy="8" r="1.1" fill="currentColor" />
          <circle cx="7.5" cy="8" r="1.1" fill="currentColor" />
          <circle cx="2.5" cy="13" r="1.1" fill="currentColor" />
          <circle cx="7.5" cy="13" r="1.1" fill="currentColor" />
        </svg>
      </button>

      <!-- 角色：頭像（左，兼作選單觸發框）＋ 名稱（右）。屬性色識別由左側色條承載。 -->
      <div class="header__identity">
        <CharacterSelector
          class="header__portrait"
          :model-value="character?.id ?? null"
          :options="characterStore.allCharacters"
          :placeholder="$t('swimlane.selectCharacter')"
          @update:model-value="handleSelectCharacter"
        >
          <template #trigger>
            <!-- 頭像框即觸發器：hover 發光 + 原生 title 於游標旁提示。 -->
            <span
              class="header__portrait-frame"
              :title="character ? $t('swimlane.changeCharacter', { name: charName }) : $t('swimlane.selectCharacter')"
            >
              <img
                v-if="character?.avatar"
                class="header__avatar"
                :src="character.avatar"
                :alt="charName"
              />
              <span
                v-else
                class="header__avatar header__avatar--placeholder"
                aria-hidden="true"
              >＋</span>
            </span>
          </template>
        </CharacterSelector>

        <span v-if="character" class="header__name">{{ charName }}</span>
        <span v-else class="header__name header__empty-name">{{ $t('swimlane.selectCharacter') }}</span>
      </div>

      <!-- 取消選角：右下角小圓鈕，滑鼠移入 header 時才浮現。 -->
      <button
        v-if="character"
        class="header__deselect"
        type="button"
        :aria-label="$t('swimlane.deselect')"
        :title="$t('swimlane.deselect')"
        @click.stop="handleDeselectCharacter"
      >
        <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true">
          <path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
        </svg>
      </button>
    </div>

    <div
      class="swimlane__track"
      role="list"
      :aria-label="character ? $t('swimlane.blockSeqOf', { name: charName }) : $t('swimlane.blockSeq')"
      @click="handleTrackClick"
    >
      <div class="track__inner">

        <div v-if="!character" class="track__empty-hint" :aria-label="$t('swimlane.pickFirstLabel')">
          {{ $t('swimlane.pickFirstHint') }}
        </div>

        <template v-else>
          <div
            ref="trackEl"
            class="track__draggable"
            :class="{ 'track__draggable--empty': localEntries.length === 0 }"
            :style="{ gridTemplateColumns: gridTemplate }"
          >
            <RotationBlock
              v-for="entry in localEntries"
              :key="entry.id"
              :data-tour="slotIndex === 0 && entry.id === localEntries[0]?.id ? 'first-block' : undefined"
              :entry-id="entry.id"
              :label="entry.block.label"
              :color="laneColor"
              :is-selected="rotationStore.isSelected(entry.id)"
              :multi-select-count="rotationStore.selectedIds.size"
              :is-editing="rotationStore.editingId === entry.id"
              :is-leaving="rotationStore.isLeaving(entry.id)"
              :style="blockStyle(entry.id)"
              role="listitem"
              @select="(event) => handleBlockSelect(entry.id, event)"
              @request-edit="handleRequestEdit(entry.id)"
              @draft-change="(text: string) => rotationStore.setEditingDraft(text)"
              @commit="(label) => handleCommitLabel(entry.id, label)"
              @cancel="handleCancelEdit(entry.id)"
            />

            <!-- 落點空欄虛框：只有落點泳道畫；其他兩泳道因共用 template 也會同步空出該欄 -->
            <div
              v-if="previewSlotIndex === slotIndex && placeholderColumn != null"
              class="track__preview-slot"
              :style="{ gridColumn: String(placeholderColumn + 1) }"
              aria-hidden="true"
            />

            <!-- ＋ 按鈕：定位在該泳道自己最後一個區塊之後（共用 grid 內以 grid-column 釘位）。
                 被 SortableJS draggable:'.rotation-block' 選擇器排除，不會被當成可拖項。
                 拖曳預覽期間隱藏，避免與落點空欄搶欄、或造成 grid 欄數變動。 -->
            <button
              class="track__add-btn"
              :class="{ 'track__add-btn--drag-hidden': dragState.isDragging }"
              :style="{ gridColumn: String(addButtonColumn + 1) }"
              :data-tour="slotIndex === 0 ? 'add-block' : undefined"
              type="button"
              :aria-label="$t('swimlane.addBlockLabel', { name: charName })"
              :title="$t('swimlane.addBlockTitle', { name: charName })"
              @click.stop="handleAddBlock"
            >
              ＋
            </button>
          </div>

          <div
            v-if="localEntries.length === 0 && idToColumnIndex.size === 0 && dragState.isDragging && dragState.sourceType !== 'rotation-instance'"
            class="track__empty-dropzone"
            aria-hidden="true"
          >
            {{ $t('swimlane.dropHere') }}
          </div>
        </template>

      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── CSS 自訂屬性 ────────────────────────────────────────── */
.swimlane {
  /* header 寬度由 RotationBoard 依最長角色名動態下傳；獨立使用時回退 10.5rem。 */
  --header-width: var(--board-header-width, 10.5rem);
  --lane-height: 4rem;
  --lane-color: rgba(255, 255, 255, 0.18);
  /* --track-gap 由 template :style 注入（單一來源＝constants/layout.ts 的 TRACK_GAP_PX） */
  --track-px: 0.75rem;

  display: flex;
  align-items: stretch;
  height: var(--lane-height);
  /* 共用水平捲動：泳道由內容撐寬（max-content），但至少填滿捲動視窗（min-width:100%），
     讓三泳道等寬且對齊；橫向捲軸統一由上層 .board__scroll 提供。 */
  width: max-content;
  min-width: 100%;

  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.swimlane:last-child {
  border-bottom: none;
}

.swimlane--slot-0 { background: rgba(255, 255, 255, 0.020); }
.swimlane--slot-1 { background: rgba(255, 255, 255, 0.013); }
.swimlane--slot-2 { background: rgba(255, 255, 255, 0.006); }

/* ══════════════════════════════════════════════════════════
   左側 Header
   ══════════════════════════════════════════════════════════ */
.swimlane__header {
  /* sticky 固定在左側：橫向捲動時角色名不跟著捲走。
     必須用不透明底色，否則捲動時區塊會從 header 下方透出。 */
  position: sticky;
  left: 0;
  flex-shrink: 0;
  width: var(--header-width);

  /* 橫向排列：色條 | 拖曳把手 | 屬性(圖示+文字) | 角色(頭像+名稱) | 右側控制。 */
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.35rem 0 0.6rem; /* 左緣多留空給垂直色條 */

  border-right: 1px solid rgba(255, 255, 255, 0.07);

  z-index: 5;
  /* 不透明底（面板深色），上面再疊各槽位細微色調 */
  background-color: #0b101d;
}

/* 拖曳區塊期間：header 整體不可互動。forceFallback 浮動分身跟手經過 sticky
   header 上方時，滑鼠 hover 會誤觸角色頭像原生 title 提示與「取消選角」鈕浮現。
   拖曳中一律穿透（不攔 hover / 不吃點擊），放開後恢復。 */
.swimlane__header--drag-inert {
  pointer-events: none;
}

/* 左側垂直色條：改為沿左緣的直條（原為頂部橫條）。 */
.header__color-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  transition: background-color 0.25s ease;
}

/* 角色欄：頭像（左，大）＋ 名稱（右，靠右對齊）。佔剩餘寬度。 */
.header__identity {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}
/* 頭像即選單觸發框：把 CharacterSelector 的觸發鈕還原成裸容器、尺寸貼齊頭像。 */
.header__portrait {
  flex-shrink: 0;
  width: auto;
  line-height: 0;
}
.header__portrait :deep(.char-selector__trigger) {
  width: auto;
  height: auto;
  padding: 0;
  gap: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.header__portrait :deep(.char-selector__trigger:focus) {
  outline: none;
}
.header__portrait-frame {
  display: inline-flex;
}

.header__avatar {
  display: block;
  width: 2.85rem;
  height: 2.85rem;
  border-radius: 6px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
/* 未選角：灰底方塊置中顯示「＋」提示可點選。 */
.header__avatar--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  line-height: 1;
  color: rgba(255, 255, 255, 0.35);
}
/* hover / 選單開啟：以屬性色（--lane-color）發出光暈 + 放大。
   強調框用 inset box-shadow 疊在圖片內側（非 border），避免與圖片間留黑縫；
   inset 支援小數，1.5px 取得 1~2px 之間的粗細。 */
.header__portrait :deep(.char-selector__trigger:hover) .header__avatar,
.header__portrait :deep(.char-selector__trigger--open) .header__avatar {
  border-color: var(--lane-color, rgba(34, 211, 238, 0.8));
  box-shadow: inset 0 0 0 1.5px var(--lane-color, rgba(34, 211, 238, 0.8)),
    0 0 12px var(--lane-color, rgba(34, 211, 238, 0.6));
  transform: scale(1.04);
}
.header__portrait :deep(.char-selector__trigger:focus-visible) .header__avatar {
  border-color: var(--lane-color, rgba(34, 211, 238, 0.8));
  box-shadow: inset 0 0 0 1.5px var(--lane-color, rgba(34, 211, 238, 0.8));
}

.header__name {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.1;
  color: rgba(245, 249, 252, 0.98);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.header__empty-name {
  font-weight: 500;
  color: rgba(240, 244, 248, 0.4);
  user-select: none;
}

/* 取消選角：右下角小圓鈕；平時隱藏，header hover 才浮現。 */
.header__deselect {
  position: absolute;
  right: 0.28rem;
  bottom: 0.22rem;
  z-index: 7;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  background: rgba(11, 16, 29, 0.9);
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}
.swimlane__header:hover .header__deselect,
.header__deselect:focus-visible {
  opacity: 1;
}
.header__deselect:hover {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.6);
  background: rgba(248, 113, 113, 0.14);
}
.header__deselect:focus {
  outline: none;
}
.header__deselect:focus-visible {
  outline: 1px solid rgba(248, 113, 113, 0.6);
  outline-offset: 1px;
}

/* 泳道拖曳把手：header 最左欄、垂直置中（靠左緣對齊） */
.header__drag-handle {
  flex-shrink: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 0.875rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: grab;
  transition: color 0.15s ease;
}
.header__drag-handle:hover {
  color: rgba(34, 211, 238, 0.85);
}
.header__drag-handle:active {
  cursor: grabbing;
}
.header__drag-handle:focus {
  outline: none;
}
.header__drag-handle:focus-visible {
  color: rgba(34, 211, 238, 0.85);
}

/* 泳道拖曳中：來源泳道原位留空（內容隱藏、保留高度、虛線佔位框） */
.swimlane--drag-source {
  background: rgba(125, 211, 252, 0.04);
  outline: 1.5px dashed rgba(125, 211, 252, 0.35);
  outline-offset: -4px;
}
.swimlane--drag-source > * {
  visibility: hidden;
}

/* ══════════════════════════════════════════════════════════
   右側 Track（可橫向捲動）
   ══════════════════════════════════════════════════════════ */
.swimlane__track {
  flex: 1;
  min-width: 0;
  /* 不再各自捲動：橫向捲軸統一由上層 .board__scroll 提供，確保三泳道捲動同步、對齊不破 */
  overflow: visible;
}

.track__inner {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--track-gap);
  height: 100%;
  padding: 0 var(--track-px);
  width: max-content;
  min-width: 100%;
}

/* 單線程欄位對齊：以 grid 取代 flex，gridTemplateColumns 由父層注入（三泳道共用）。
   真實區塊用 grid-column 放到全域欄位，未佔用的欄自然留白 → 縱向對齊。 */
.track__draggable {
  display: grid;
  grid-auto-flow: column;
  align-items: center;
  gap: var(--track-gap);
  width: max-content;
}

/* 本 grid 依設計恆為「單列」：所有子項（區塊/落點空欄/＋按鈕）一律釘第 1 列。
   否則兩個子項落在同一欄時（如拖到尾端：落點空欄與 ＋ 的欄位重疊），grid
   自動排版會把後者擠到第 2 列 → 固定 64px 的泳道被切成兩列、區塊整排上移。
   同欄改為同格重疊（拖曳中 ＋ 已隱藏，無視覺衝突）。 */
.track__draggable > * {
  grid-row: 1;
}

/* 泳道本身為空時撐滿，讓 SortableJS 在任意位置都能命中此清單。
   但若全域序列非空（gridTemplate 有值），仍需保留 grid 欄位以維持對齊，
   故 flex 撐滿只在「全域也為空」時才套用（此時 gridTemplate 為空字串）。 */
.track__draggable--empty:not([style*='grid-template-columns:']) {
  display: flex;
  flex: 1;
  align-self: stretch;
}

/* 落點空欄虛框（拖曳預覽）：佔據共用 grid 的落點欄，呈現「將插入於此」的提示。
   高度貼齊區塊；不攔截滑鼠事件（hit-test 用 elementFromPoint 需穿透）。 */
.track__preview-slot {
  align-self: center;
  height: 3rem;
  border: 1.5px dashed rgba(125, 211, 252, 0.7);
  border-radius: 3px;
  background: rgba(125, 211, 252, 0.10);
  pointer-events: none;
}

.track__empty-dropzone {
  position: absolute;
  top: 0.25rem;
  bottom: 0.25rem;
  left: var(--track-px);
  right: var(--track-px);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(125, 211, 252, 0.45);
  border-radius: 6px;
  background: rgba(125, 211, 252, 0.06);
  color: rgba(125, 211, 252, 0.65);
  font-size: 0.6875rem;
  letter-spacing: 0.05em;
  user-select: none;
  pointer-events: none;
}

/* ＋ 按鈕現位於共用 grid 內，用 grid-column 釘在該泳道最後一個區塊之後。
   align-self/justify-self 控制其在欄內的對齊；空泳道（flex fallback）時自然靠左。 */
/* 拖曳期間隱藏 ＋ 但保留其 grid 欄位（visibility 而非 display:none）：
   display:none 會讓尾端隱式欄收合、scrollWidth 縮短，捲到最右時 scrollLeft 被夾回
   而畫面往左跳（拖任何區塊皆抖動）。改 visibility 保留欄寬即不跳。
   grid-row:1 必釘：＋ 的欄序是靜止版，拖曳預覽時落點空欄可能佔到同一欄，
   若不釘列，grid 自動排版會把 ＋ 擠到第二列 → 泳道被撐高、整排區塊上移。
   已隱藏故與空欄同格重疊無妨。 */
.track__add-btn--drag-hidden {
  visibility: hidden;
  pointer-events: none;
  grid-row: 1;
}

.track__add-btn {
  align-self: center;
  justify-self: start;
  margin-left: 0.5rem; /* 與前一區塊拉開一點距離，避免緊貼 */
  display: flex;
  align-items: center;
  justify-content: center;

  width: 1.5rem;
  height: 1.5rem;
  border-radius: 4px;
  border: 1px dashed rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.6);

  font-size: 0.875rem;
  line-height: 1;
  cursor: pointer;

  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease;
}

.track__add-btn:hover,
.track__add-btn:focus-visible {
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.1);
}

/* 移除瀏覽器預設 focus ring（橘/白外框，非本專案實作）；
   改用與 hover 一致的回饋（focus-visible）保留鍵盤可視性。 */
.track__add-btn:focus {
  outline: none;
}

.track__add-btn:active {
  background: rgba(255, 255, 255, 0.10);
  transform: scale(0.93);
}

.track__empty-hint {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.18);
  letter-spacing: 0.05em;
  user-select: none;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .header__color-bar {
    transition: none;
  }
}
</style>
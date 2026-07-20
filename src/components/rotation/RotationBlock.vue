<script setup lang="ts">
// RotationBlock.vue：主時間軸區塊的純展示層 (Dumb Component)
// 職責：UI 渲染與事件上拋；行內編輯的開合狀態由父層 (Swimlane) 以 isEditing 控制，
//       本元件只負責「進入編輯時聚焦輸入、提交/取消時上拋」，不直接碰 store。

import { ref, watch, nextTick } from 'vue'
import BlockChip from '@/components/ui/BlockChip.vue'

interface Props {
  /** 區塊 ID (供上拋事件辨識用) */
  entryId: string
  /** 區塊顯示文字 */
  label: string
  /** 區塊背景色 hex */
  color: string
  /** 是否被選取 */
  isSelected?: boolean
  /** 是否處於行內編輯（由父層控制：新增即編輯 / 雙擊編輯） */
  isEditing?: boolean
  /** 文字反白：多選同步編輯時，批次成員鏡射輸入框的全選狀態 */
  isLabelHighlighted?: boolean
  /** 編輯態邊框調暗：多選同步編輯時，批次成員的選取邊框比照輸入框調暗 */
  isEditingDimmed?: boolean
  /** 是否正在播放刪除消失動畫 */
  isLeaving?: boolean
  /** 目前主軸選取總數（多選拖曳時，分身上顯示此數量徽章） */
  multiSelectCount?: number
}

const props = withDefaults(defineProps<Props>(), {
  isSelected: false,
  isEditing: false,
  isLabelHighlighted: false,
  isEditingDimmed: false,
  isLeaving: false,
  multiSelectCount: 0,
})

const emit = defineEmits<{
  /** 點擊選取。上拋原始 MouseEvent 供父層處理 Ctrl/Meta 多選邏輯 */
  select: [event: MouseEvent]
  /** 雙擊要求進入編輯 */
  'request-edit': []
  /** 編輯框即時草稿變動（供量測列即時重算欄寬，達成編輯時即時變寬） */
  'draft-change': [value: string]
  /** 提交新文字（trim 與空字串處理交給父層 / store） */
  commit: [label: string]
  /** 取消編輯 */
  cancel: []
}>()

// 本地 UI 狀態 (僅供 hover 視覺反饋)
const isHovered = ref(false)

// 行內編輯草稿與輸入框參照
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
// 避免 Enter 提交後 blur 再次提交造成重複（commit 會清 editing → 觸發 blur）
let finishing = false

// 進入編輯時：以目前 label 初始化草稿，聚焦並全選文字
watch(
  () => props.isEditing,
  (editing) => {
    if (editing) {
      draft.value = props.label
      finishing = false
      void nextTick(() => {
        // preventScroll：避免原生聚焦把新區塊「瞬間」捲入視野，
        // 蓋掉 scrollEntryIntoView 的平滑捲動（<space> 新增須比照貼上效果）
        inputRef.value?.focus({ preventScroll: true })
        inputRef.value?.select()
      })
    }
  },
  { immediate: true },
)

// 點擊事件：阻擋冒泡並將原始事件上拋
function handleClick(event: MouseEvent): void {
  event.stopPropagation()
  emit('select', event)
}

function handleDblClick(event: MouseEvent): void {
  event.stopPropagation()
  emit('request-edit')
}

// 每次輸入即把草稿上拋，父層轉存 store → 量測列即時重算欄寬
function onDraftInput(event: Event): void {
  emit('draft-change', (event.target as HTMLInputElement).value)
}

function commit(): void {
  if (finishing) return
  finishing = true
  emit('commit', draft.value)
}

function cancel(): void {
  if (finishing) return
  finishing = true
  emit('cancel')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    commit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}
</script>

<template>
  <div
    class="rotation-block"
    :class="{ 'is-leaving': isLeaving }"
    :data-entry-id="entryId"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @click="handleClick"
    @dblclick="handleDblClick"
  >
    <!-- 編輯態：以輸入框取代 chip 顯示。mousedown/pointerdown 阻擋冒泡，
         避免 SortableJS 在點擊輸入框定位游標時誤啟動拖曳。 -->
    <input
      v-if="isEditing"
      ref="inputRef"
      v-model="draft"
      class="rotation-block__input"
      type="text"
      :style="{ '--chip-bg': color }"
      @input="onDraftInput"
      @keydown="onKeydown"
      @blur="commit"
      @click.stop
      @mousedown.stop
      @pointerdown.stop
    />
    <BlockChip
      v-else
      :label="label"
      :color="color"
      :is-hovered="isHovered && !isSelected"
      :is-selected="isSelected"
      :is-label-highlighted="isLabelHighlighted"
      :is-editing-dimmed="isEditingDimmed"
    />

    <!-- 多選拖曳數量徽章：放在 chip 之外（不被 chip overflow 裁切），平時 display:none，
         只在 SortableJS 浮動分身（.sortable-fallback）上顯示（規則在 style.css）。
         右上角、部分溢出 chip，z-index 高於 chip。 -->
    <span
      v-if="isSelected && multiSelectCount > 1"
      class="rotation-block__drag-count"
      aria-hidden="true"
    >
      {{ multiSelectCount }}
    </span>
  </div>
</template>

<style scoped>
/* 隱藏外層包裝盒模型，避免破壞 flex 排版 */
.rotation-block {
  display: inline-flex;;
  /* 作為數量徽章的定位基準（不影響 SortableJS 的 transform 浮動） */
  position: relative;
}

/* 多選拖曳數量徽章：右上角圓點，部分溢出 chip；平時隱藏，
   只在浮動分身（.sortable-fallback）上顯示（顯示規則見 style.css）。 */
.rotation-block__drag-count {
  display: none;
  position: absolute;
  top: -7px;
  right: -7px;
  z-index: 20; /* 高於 chip（label z-index 2、選中光暈等）*/
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background-color: #22d3ee;
  color: #06121a;
  font-family: var(--app-font-mono, 'JetBrains Mono', 'Fira Code', 'Consolas', ui-monospace), sans-serif;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
  border: 1.5px solid rgba(6, 18, 26, 0.85);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

/* 刪除消失動畫：刻意只動內層 .block-chip 的 opacity/transform，不碰 .rotation-block
   的 transform（該屬性保留給 SortableJS 浮動分身與拖曳 FLIP，見專案記憶）。
   forwards 保留結束幀，避免移除前的最後一刻閃回原狀。 */
.rotation-block.is-leaving {
  pointer-events: none;
}

.rotation-block.is-leaving :deep(.block-chip) {
  animation: block-leave 0.18s ease forwards;
}

@keyframes block-leave {
  to {
    opacity: 0;
    transform: scale(0.78);
  }
}

@media (prefers-reduced-motion: reduce) {
  .rotation-block.is-leaving :deep(.block-chip) {
    animation: none;
  }
}

/* 行內編輯輸入框：填滿由草稿即時驅動的欄寬（grid item 預設 stretch → 等於欄寬）。
   padding / letter-spacing / 字型須與 BlockChip 對齊，使量測列（量 chip 草稿）算出的
   欄寬恰好容納相同文字，輸入時不裁字、進出編輯不跳寬。box-sizing:border-box 讓
   width:100% 含內距/邊框＝欄寬。 */
.rotation-block__input {
  box-sizing: border-box;
  width: 100%;
  height: 3rem;
  padding: 0 var(--chip-px-setting, 1rem);
  border: 1.5px solid rgba(125, 211, 252, 0.85);
  border-radius: 3px;
  background-color: var(--chip-bg, #1e293b);
  /* 文字樣式須與 BlockChip label 對齊（純白 + 1px 加深描邊 + 雙層投影），
     使進出編輯不變樣、亮色塊上同樣讀得清。 */
  color: #ffffff;
  -webkit-text-stroke: 1px rgba(8, 12, 24, 0.78);
  paint-order: stroke fill;
  text-shadow:
    0 0 1px rgba(8, 12, 24, 0.85),
    0 1px 3px rgba(0, 0, 0, 0.45);
  /* 游標(caret)用深色：輸入框底為屬性塊色（多為飽和中亮色，且淺色如氣動綠、
     衍射黃、凝夜青最需對比），深游標在這些淺底上都顯眼好定位（青游標在青/綠
     底上會隱形，正是原本淺色區看不清的主因）。 */
  caret-color: #06121a;
  font-family: var(--app-font-mono, 'JetBrains Mono', 'Fira Code', 'Consolas', ui-monospace),
    'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.05em;
  outline: none;
  box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.2);
}

/* 輸入框全選文字的反白：實心海軍藍底＋白字，與 BlockChip
   .block-chip__label--highlighted 同款，使多選同步編輯時主要區塊
   與批次成員的反白看起來是同一個選取。海軍藍在任何底色上都與白字高對比。 */
.rotation-block__input::selection {
  background-color: #00217d;
  color: #ffffff;
}
</style>

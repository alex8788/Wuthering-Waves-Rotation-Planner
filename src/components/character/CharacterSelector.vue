<script lang="ts">
// 模組層級計數器：確保畫面上同時存在多個 CharacterSelector
// （三條泳道各一個）時，ARIA id 仍能保持全域唯一。
let uidCounter = 0
</script>

<script setup lang="ts">
// ============================================================
// CharacterSelector.vue
// 角色選擇下拉選單。
//
// 設計決策（已與使用者確認）：
// 1. options 直接使用 Character[] 型別，元件與角色領域耦合，
//    顯示文字採用 nameZh。
// 2. 自訂 div-based 下拉選單（非原生 <select>），以完全控制
//    色點／發光樣式，確保跨瀏覽器呈現一致。
// 3. 每個選項旁顯示對應角色 themeColor 色點，強化辨識度。
//
// 互動模式採用 ARIA combobox pattern：焦點始終停留在觸發按鈕，
// 透過 aria-activedescendant 標示目前鍵盤高亮的選項，
// 不將焦點移入 listbox 本身。
// ============================================================

import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { getElementColor } from '@/constants/elements'
import type { Character, CharacterElement } from '@/types/character'

export interface Props {
  /** 目前選中的角色 ID；null 代表該槽位尚未選擇角色 */
  modelValue: string | null
  /** 可選角色清單 */
  options: Character[]
  /** 尚未選擇時顯示的提示文字 */
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '選擇角色',
})

const emit = defineEmits<{
  /** 選中某個角色時觸發，value 一定是 options 中某個角色的 id */
  (e: 'update:modelValue', value: string): void
}>()

// ── ARIA 唯一 ID ─────────────────────────────────────────
const instanceId = ++uidCounter
const listboxId = `char-selector-listbox-${instanceId}`

// ── 內部狀態（互動狀態，非業務資料，元件自行管理開合與高亮） ──
const isOpen = ref(false)
const highlightedIndex = ref(0)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const listboxRef = ref<HTMLElement | null>(null)
const optionRefs: (HTMLLIElement | null)[] = []

// 下拉清單 Teleport 到 <body> 並採 position:fixed，依 trigger 視窗座標定位。
// 原因：本元件嵌在泳道 sticky header（位於 .board__scroll 的 overflow 容器內），
// 若留在原處會被 overflow 裁切、且若有 transform 祖先 fixed 也會失效並被下方泳道蓋住
// （a1/a2）。Teleport 到 body 徹底脫離祖先的裁切與堆疊脈絡。座標於開啟時量取，
// 外層捲動/縮放時關閉（onWindowChange）；選單自身的捲動則排除、不關閉（a4）。
const dropdownStyle = ref<Record<string, string>>({})

function updateDropdownPosition(): void {
  const el = triggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  dropdownStyle.value = {
    position: 'fixed',
    top: `${r.bottom + 6}px`,
    left: `${r.left}px`,
    // a3：至少與 trigger 同寬，但給較大下限讓較長角色名不被截斷
    minWidth: `${Math.max(r.width, 180)}px`,
  }
}

// a5：依鳴潮角色屬性（element）分組。每個選項保留其在 props.options 的扁平索引，
// 讓鍵盤高亮（highlightedIndex 對應扁平 options）與分組渲染共用同一套索引。
const groupedOptions = computed<{ element: CharacterElement; items: { char: Character; index: number }[] }[]>(() => {
  const groups: { element: CharacterElement; items: { char: Character; index: number }[] }[] = []
  const byElement = new Map<CharacterElement, { char: Character; index: number }[]>()
  props.options.forEach((char, index) => {
    let bucket = byElement.get(char.element)
    if (!bucket) {
      bucket = []
      byElement.set(char.element, bucket)
      groups.push({ element: char.element, items: bucket })
    }
    bucket.push({ char, index })
  })
  return groups
})

// a5/2-1：屬性頁籤版型。tabs＝有序屬性清單；目前選中的頁籤決定只顯示哪一屬性的角色。
const elements = computed<CharacterElement[]>(() => groupedOptions.value.map((g) => g.element))
const activeTabElement = ref<CharacterElement | null>(null)
const activeItems = computed<{ char: Character; index: number }[]>(
  () => groupedOptions.value.find((g) => g.element === activeTabElement.value)?.items ?? [],
)

function setActiveTab(element: CharacterElement): void {
  activeTabElement.value = element
  // 切頁籤時把高亮移到該頁籤第一個角色（highlightedIndex 仍對 props.options 的扁平索引）
  const items = groupedOptions.value.find((g) => g.element === element)?.items ?? []
  highlightedIndex.value = items[0]?.index ?? 0
  scrollHighlightedIntoView()
}

function moveTab(delta: number): void {
  const els = elements.value
  if (els.length === 0) return
  const cur = activeTabElement.value ? els.indexOf(activeTabElement.value) : 0
  setActiveTab(els[(cur + delta + els.length) % els.length])
}

function setOptionRef(el: Element | null, index: number): void {
  optionRefs[index] = el as HTMLLIElement | null
}

// ── 衍生資料 ─────────────────────────────────────────────
const selectedCharacter = computed<Character | null>(
  () => props.options.find((o) => o.id === props.modelValue) ?? null
)

// ── 開合與高亮控制 ───────────────────────────────────────
function scrollHighlightedIntoView(): void {
  nextTick(() => {
    optionRefs[highlightedIndex.value]?.scrollIntoView({ block: 'nearest' })
  })
}

function openDropdown(): void {
  const selected = props.options.find((o) => o.id === props.modelValue)
  // 開啟時頁籤定位到選中角色的屬性（未選角→第一個屬性），高亮對應角色
  activeTabElement.value = selected?.element ?? elements.value[0] ?? null
  const selectedIdx = props.options.findIndex((o) => o.id === props.modelValue)
  highlightedIndex.value = selectedIdx >= 0 ? selectedIdx : (activeItems.value[0]?.index ?? 0)
  updateDropdownPosition()
  isOpen.value = true
  scrollHighlightedIntoView()
}

function closeDropdown(): void {
  isOpen.value = false
}

function toggleDropdown(): void {
  if (isOpen.value) {
    closeDropdown()
  } else {
    openDropdown()
  }
}

// 上下移動：限制在「目前頁籤的角色」之內（不再跨整個扁平清單）
function moveHighlight(delta: number): void {
  const items = activeItems.value
  if (items.length === 0) return
  const cur = items.findIndex((it) => it.index === highlightedIndex.value)
  const next = cur < 0 ? 0 : (cur + delta + items.length) % items.length
  highlightedIndex.value = items[next].index
  scrollHighlightedIntoView()
}

function selectOption(option: Character): void {
  emit('update:modelValue', option.id)
  closeDropdown()
}

function selectHighlighted(): void {
  const option = props.options[highlightedIndex.value]
  if (option) selectOption(option)
}

// ── 鍵盤操作（焦點全程停留在 trigger 按鈕上） ────────────────
function onTriggerKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      isOpen.value ? moveHighlight(1) : openDropdown()
      break
    case 'ArrowUp':
      event.preventDefault()
      isOpen.value ? moveHighlight(-1) : openDropdown()
      break
    case 'ArrowRight':
      if (isOpen.value) {
        event.preventDefault()
        moveTab(1)
      }
      break
    case 'ArrowLeft':
      if (isOpen.value) {
        event.preventDefault()
        moveTab(-1)
      }
      break
    case 'Home':
      if (isOpen.value) {
        event.preventDefault()
        highlightedIndex.value = activeItems.value[0]?.index ?? 0
        scrollHighlightedIntoView()
      }
      break
    case 'End':
      if (isOpen.value) {
        event.preventDefault()
        const items = activeItems.value
        highlightedIndex.value = items[items.length - 1]?.index ?? 0
        scrollHighlightedIntoView()
      }
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      isOpen.value ? selectHighlighted() : openDropdown()
      break
    case 'Escape':
      if (isOpen.value) {
        event.preventDefault()
        closeDropdown()
      }
      break
    case 'Tab':
      // 允許瀏覽器預設的 Tab 移焦行為，僅收合選單
      closeDropdown()
      break
  }
}

// ── 點擊外部關閉 ─────────────────────────────────────────
// listbox 已 Teleport 到 body（不在 rootRef 內），需一併排除，否則點選項時
// mousedown 會先判定為「外部」而關閉，導致 click 還沒選到就消失。
function onDocumentMouseDown(event: MouseEvent): void {
  const t = event.target as Node
  const inRoot = rootRef.value?.contains(t)
  const inListbox = listboxRef.value?.contains(t)
  if (!inRoot && !inListbox) closeDropdown()
}

// 外層（泳道捲動容器 / 視窗）捲動或縮放時，fixed 定位的選單會與 trigger 脫鉤 →
// 關閉以免停在錯位（重開即取得新座標）。但「選單自身的內部捲動」要排除，
// 否則滾輪瀏覽長清單會立刻收合（a4）。capture 以接住內層容器捲動。
function onWindowChange(event: Event): void {
  if (!isOpen.value) return
  if (listboxRef.value && event.target instanceof Node && listboxRef.value.contains(event.target)) return
  closeDropdown()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown)
  window.addEventListener('scroll', onWindowChange, true)
  window.addEventListener('resize', onWindowChange)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  window.removeEventListener('scroll', onWindowChange, true)
  window.removeEventListener('resize', onWindowChange)
})
</script>

<template>
  <div ref="rootRef" class="char-selector">
    <button
      ref="triggerRef"
      type="button"
      class="char-selector__trigger"
      :class="{ 'char-selector__trigger--open': isOpen }"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-controls="listboxId"
      :aria-activedescendant="isOpen ? `${listboxId}-option-${highlightedIndex}` : undefined"
      @click="toggleDropdown"
      @keydown="onTriggerKeydown"
    >
      <span
        v-if="selectedCharacter"
        class="char-selector__swatch"
        :style="{ '--swatch-color': getElementColor(selectedCharacter.element) }"
        aria-hidden="true"
      />
      <span
        class="char-selector__value"
        :class="{ 'char-selector__value--placeholder': !selectedCharacter }"
      >
        {{ selectedCharacter ? selectedCharacter.nameZh : placeholder }}
      </span>
      <span class="char-selector__chevron" aria-hidden="true">▾</span>
    </button>

    <Teleport to="body">
      <Transition name="dropdown">
        <ul
          v-if="isOpen"
          :id="listboxId"
          ref="listboxRef"
          class="char-selector__listbox"
          :style="dropdownStyle"
          role="listbox"
          @wheel.stop
        >
          <!-- 屬性頁籤列：每個頁籤一條屬性色條（2-2 改由此處表示顏色），點擊切換顯示該屬性角色 -->
          <li class="char-selector__tabs" role="presentation">
            <button
              v-for="el in elements"
              :key="el"
              type="button"
              class="char-selector__tab"
              :class="{ 'char-selector__tab--active': el === activeTabElement }"
              :style="{ '--tab-color': getElementColor(el) }"
              :aria-label="`屬性 ${el}`"
              @click="setActiveTab(el)"
            >
              <span class="char-selector__tab-bar" aria-hidden="true" />
              <span class="char-selector__tab-label">{{ el }}</span>
            </button>
          </li>

          <!-- 僅顯示目前頁籤屬性的角色；移除角色色點，左側保留頭像佔位（未來放角色頭像） -->
          <li
            v-for="{ char, index } in activeItems"
            :id="`${listboxId}-option-${index}`"
            :key="char.id"
            :ref="(el) => setOptionRef(el as Element | null, index)"
            role="option"
            class="char-selector__option"
            :class="{
              'char-selector__option--highlighted': index === highlightedIndex,
              'char-selector__option--selected': char.id === modelValue,
            }"
            :aria-selected="char.id === modelValue"
            @mouseenter="highlightedIndex = index"
            @click="selectOption(char)"
          >
            <span class="char-selector__avatar" aria-hidden="true" />
            <span class="char-selector__option-name">{{ char.nameZh }}</span>
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.char-selector {
  position: relative;
  width: 100%;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

/* ── 觸發按鈕 ───────────────────────────────────────────── */
.char-selector__trigger {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  height: 2.75rem; /* 44px */
  padding: 0 0.75rem;
  background-color: #111827;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  color: rgba(240, 244, 248, 0.92);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.char-selector__trigger:hover {
  border-color: rgba(34, 211, 238, 0.35);
}

.char-selector__trigger:focus-visible {
  outline: none;
  border-color: rgba(34, 211, 238, 0.65);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.15);
}

.char-selector__trigger--open {
  border-color: rgba(34, 211, 238, 0.70);
  box-shadow: 0 0 10px rgba(34, 211, 238, 0.18);
}

/* ── 色點（trigger 與 option 共用） ───────────────────────── */
.char-selector__swatch {
  flex-shrink: 0;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
  background-color: var(--swatch-color, #6B7280);
  box-shadow: 0 0 6px var(--swatch-color, transparent);
}

/* ── 顯示文字 ───────────────────────────────────────────── */
.char-selector__value {
  flex: 1;
  overflow: hidden;
  text-align: left;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.char-selector__value--placeholder {
  color: rgba(240, 244, 248, 0.40);
  font-weight: 500;
}

.char-selector__chevron {
  flex-shrink: 0;
  font-size: 0.625rem;
  color: rgba(240, 244, 248, 0.45);
  transition: transform 0.18s ease, color 0.18s ease;
}

.char-selector__trigger--open .char-selector__chevron {
  color: rgba(34, 211, 238, 0.85);
  transform: rotate(180deg);
}

/* ── 下拉清單 ───────────────────────────────────────────── */
.char-selector__listbox {
  /* position / top / left / width 由 dropdownStyle 內聯注入（fixed，避免被 overflow 裁切） */
  position: fixed;
  z-index: 1000;
  max-height: 320px;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  overflow-y: auto;
  background-color: #111827;
  border: 1px solid rgba(34, 211, 238, 0.25);
  border-radius: 4px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.20);
  transform-origin: top;
}

.char-selector__listbox::-webkit-scrollbar {
  width: 6px;
}
.char-selector__listbox::-webkit-scrollbar-track {
  background: transparent;
}
.char-selector__listbox::-webkit-scrollbar-thumb {
  background-color: rgba(34, 211, 238, 0.25);
  border-radius: 3px;
}

/* ── 屬性頁籤列（2-1 / 2-2） ─────────────────────────────── */
.char-selector__tabs {
  position: sticky;
  top: -0.25rem;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: -0.25rem -0.25rem 0.25rem;
  padding: 0.375rem;
  background-color: #111827;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.char-selector__tab {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0.25rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.6875rem;
  color: rgba(240, 244, 248, 0.5);
  transition: color 0.12s ease, background-color 0.12s ease;
}

.char-selector__tab:hover {
  color: rgba(240, 244, 248, 0.82);
}

.char-selector__tab--active {
  color: rgba(240, 244, 248, 0.95);
  background: rgba(255, 255, 255, 0.06);
}

.char-selector__tab-bar {
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background-color: var(--tab-color, #6b7280);
  opacity: 0.45;
  transition: opacity 0.12s ease, box-shadow 0.12s ease;
}

.char-selector__tab--active .char-selector__tab-bar {
  opacity: 1;
  box-shadow: 0 0 6px var(--tab-color, transparent);
}

.char-selector__tab-label {
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* 角色頭像佔位：暫以方塊呈現，未來換成角色頭像（取代原本的屬性色點） */
.char-selector__avatar {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.10);
}

/* ── 選項 ───────────────────────────────────────────────── */
.char-selector__option {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  height: 2.25rem;
  padding: 0 0.625rem;
  border-radius: 3px;
  font-size: 0.8125rem;
  color: rgba(240, 244, 248, 0.85);
  cursor: pointer;
  transition: background-color 0.10s ease;
}

.char-selector__option--highlighted {
  background-color: rgba(34, 211, 238, 0.12);
}

.char-selector__option--selected {
  color: #22D3EE;
  font-weight: 700;
}

.char-selector__option-name {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ── 下拉開合過場（與 BlockChip 的 Spring Bounce 語言呼應） ──── */
.dropdown-enter-active {
  transition: opacity 0.15s ease, transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.dropdown-leave-active {
  transition: opacity 0.10s ease, transform 0.10s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-6px) scaleY(0.96);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scaleY(0.98);
}

/* ── 無障礙：減少動畫模式 ──────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .char-selector__trigger,
  .char-selector__chevron,
  .char-selector__option {
    transition: none;
  }
  .dropdown-enter-active,
  .dropdown-leave-active {
    transition: opacity 0.10s ease;
  }
  .dropdown-enter-from,
  .dropdown-leave-to {
    transform: none;
  }
}
</style>

<script setup lang="ts">
// CustomBlockField.vue
// 側邊欄「自訂模板」展示與管理區，依目前三條泳道選中的角色即時分組顯示。
// 支援：拖到主軸、＋新增後即命名、雙擊重命名、點擊選取（Ctrl 多選）、
//       刪除鈕 / Delete 鍵刪除、多選整組拖曳（命名/新增比照 GeneralBlockField）。
// 不靠父層傳資料，自己讀角色與模板兩個 store，是個獨立運作的面板。
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import BlockChip from '@/components/ui/BlockChip.vue'
import DragCountBadge from '@/components/ui/DragCountBadge.vue'
import { useTemplateStore } from '@/stores/useTemplateStore'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useLaneOrder } from '@/composables/state/useLaneOrder'
import { useSidebarDragList } from '@/composables/blockDrag/useSidebarDragList'
import { getElementColor } from '@/constants/elements'
import { characterDisplayName } from '@/i18n'
import type { TemplateBlock } from '@/types/block'
import type { Character } from '@/types/character'

const templateStore = useTemplateStore()
const characterStore = useCharacterStore()
const { laneOrder } = useLaneOrder()

// 依泳道顯示順序（laneOrder）排列分組，與主面板/匯出視圖一致。
const orderedSlots = computed(() =>
  laneOrder.value
    .map((slotIndex) => characterStore.slots[slotIndex])
    .filter((s): s is (typeof characterStore.slots)[number] => !!s)
)

// 三個槽位各自的模板列表，未選角的槽位給空陣列
const slotTemplates = computed(() =>
  characterStore.slots.map((slot) =>
    slot.character ? templateStore.getTemplatesByCharacter(slot.character.id) : []
  )
)

// 套件要拖曳的清單要綁定能自己操作的陣列，所以另外存一份本地緩衝，
// 新增/刪除模板時跟著 slotTemplates 重新同步
const localTemplatesPerSlot = ref<TemplateBlock[][]>(slotTemplates.value.map((t) => [...t]))
watch(slotTemplates, (next) => {
  localTemplatesPerSlot.value = next.map((t) => [...t])
})

// 拖曳樣板（dragOptions / clone 偽裝 / 結束還原）共用 useSidebarDragList（R3）
const { dragOptions, cloneToPlaceholder, handleDragEnd, onSidebarDragStart } =
  useSidebarDragList({
    restore: () => { localTemplatesPerSlot.value = slotTemplates.value.map((t) => [...t]) },
  })

function handleDragStart(idx: number, event: { oldIndex?: number }): void {
  const template = localTemplatesPerSlot.value[idx]?.[event.oldIndex ?? -1]
  if (!template) return
  // 抓起的模板在多選集合且選取 >1 → 整組依「選取先後順序」(selectedTemplateIds
  // 為 Set，迭代序＝加入序) 一起拖；否則只拖這一個。
  if (templateStore.isTemplateSelected(template.id) && templateStore.selectedTemplateIds.size > 1) {
    const ordered = [...templateStore.selectedTemplateIds]
      .map((id) => templateStore.templates.find((t) => t.id === id))
      .filter((t): t is TemplateBlock => !!t)
    onSidebarDragStart(template, ordered)
  } else {
    onSidebarDragStart(template)
  }
}

function handleDelete(templateId: string): void {
  templateStore.deleteTemplate(templateId)
}

// ── 行內命名 / 重命名（比照 GeneralBlockField） ─────────────────
const rootRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const draft = ref('')
// 輸入框寬度隨草稿即時撐開；全形（CJK）約佔 2ch，逐字估寬並補 letter-spacing。
const WIDE_CHAR_RE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const editStyle = computed(() => {
  let ch = 0
  for (const c of draft.value) ch += WIDE_CHAR_RE.test(c) ? 2 : 1
  const spacing = (draft.value.length * 0.03).toFixed(2)
  return { width: `calc(${Math.max(ch, 1)}ch + ${spacing}em + 1.4rem)` }
})
// 進入編輯後聚焦輸入框並全選（DOM 更新後執行）。
watch(editingId, (id) => {
  if (!id) return
  void nextTick(() => {
    const el = rootRef.value?.querySelector<HTMLInputElement>('.chip-edit')
    el?.focus()
    el?.select()
  })
})

function startEdit(template: TemplateBlock): void {
  editingId.value = template.id
  draft.value = template.label
}

let finishing = false
function commitEdit(): void {
  if (finishing || editingId.value === null) return
  finishing = true
  // 空字串＝刪除、同角色重名＝不寫入（皆由 store 內處理）
  templateStore.updateTemplateLabel(editingId.value, draft.value)
  editingId.value = null
  finishing = false
}
function cancelEdit(): void {
  if (finishing || editingId.value === null) return
  finishing = true
  const id = editingId.value
  editingId.value = null
  finishing = false
  // 剛新增卻未命名（label 仍為空）→ 順手刪除避免殘留空塊。
  const tpl = templateStore.templates.find((x) => x.id === id)
  if (tpl && tpl.label.trim() === '') templateStore.deleteTemplate(id)
}
function onEditKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') { event.preventDefault(); commitEdit() }
  else if (event.key === 'Escape') { event.preventDefault(); cancelEdit() }
}

// ＋ 新增：建一個空 label 模板（色用角色屬性色），立即進入命名。
function addAndEdit(character: Character | null): void {
  if (!character) return
  const id = templateStore.addTemplate(character.id, getElementColor(character.element))
  editingId.value = id
  draft.value = ''
}

// 點擊模板：Ctrl/Cmd 多選切換；純點擊單選/再點同一個則取消。
// 拖曳後 SortableJS 仍可能補發 click，但落點是拖移而非真點擊，
// 影響僅止於選取狀態切換（無破壞性），可接受。
function handleTemplateClick(templateId: string, event: MouseEvent): void {
  if (editingId.value !== null) return
  const additive = event.ctrlKey || event.metaKey
  templateStore.toggleTemplateSelection(templateId, additive)
}

// 以 capture 階段攔截 Delete/Backspace：當模板庫有選取時優先刪模板，
// 並 stopPropagation 阻止 window 上的全域快捷鍵（會誤刪主軸選取區塊）。
function onKeydownCapture(event: KeyboardEvent): void {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (templateStore.selectedTemplateIds.size === 0) return
  const target = event.target as HTMLElement
  const tag = target?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
  event.preventDefault()
  event.stopPropagation()
  templateStore.deleteSelectedTemplates()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydownCapture, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydownCapture, true)
  // 元件卸除（切換頁籤離開自訂模板）時清掉殘留選取
  templateStore.clearTemplateSelection()
})
</script>

<template>
  <section ref="rootRef" class="custom-block-field">
    <div
      v-for="(slot, displayIdx) in orderedSlots"
      :key="slot.slotIndex"
      class="character-group"
    >
      <div class="group-header">
        <span
          class="group-color-bar"
          :style="{ backgroundColor: slot.character ? getElementColor(slot.character.element) : 'rgba(255,255,255,0.18)' }"
          aria-hidden="true"
        />
        <span class="group-label">
          {{ slot.character ? characterDisplayName(slot.character) : $t('sidebar.characterFallback', { n: slot.slotIndex + 1 }) }}
        </span>

        <span
          v-if="localTemplatesPerSlot[slot.slotIndex].length > 0"
          class="group-count"
          :aria-label="$t('sidebar.templateCount', { n: localTemplatesPerSlot[slot.slotIndex].length }, localTemplatesPerSlot[slot.slotIndex].length)"
        >
          {{ localTemplatesPerSlot[slot.slotIndex].length }}
        </span>
      </div>

      <div v-if="!slot.character" class="empty-placeholder" :aria-label="$t('sidebar.noCharacterLabel')">
        <span class="empty-text">{{ $t('sidebar.noCharacter') }}</span>
      </div>

      <div v-else class="chip-row" :aria-label="$t('sidebar.templatesOf', { name: characterDisplayName(slot.character) })">
        <VueDraggable
          v-model="localTemplatesPerSlot[slot.slotIndex]"
          item-key="id"
          tag="div"
          class="chip-row__draggable"
          :clone="cloneToPlaceholder"
          v-bind="dragOptions"
          @start="(e: { oldIndex?: number }) => handleDragStart(slot.slotIndex, e)"
          @end="handleDragEnd"
        >
          <div
            v-for="template in localTemplatesPerSlot[slot.slotIndex]"
            :key="template.id"
            class="chip-wrapper"
            @click.stop="handleTemplateClick(template.id, $event)"
            @dblclick.stop="startEdit(template)"
          >
            <!-- 命名 / 重命名：以輸入框取代 chip（比照 GeneralBlockField）。 -->
            <input
              v-if="editingId === template.id"
              v-model="draft"
              class="chip-edit"
              :style="editStyle"
              type="text"
              @keydown="onEditKeydown"
              @blur="commitEdit"
              @click.stop
              @dblclick.stop
              @mousedown.stop
              @pointerdown.stop
            />
            <template v-else>
              <BlockChip
                :label="template.label"
                :color="slot.character ? getElementColor(slot.character.element) : template.color"
                :is-selected="templateStore.isTemplateSelected(template.id)"
                compact
              />

              <!-- 多選拖曳數量徽章：樣式與顯示機制見共用元件 DragCountBadge。 -->
              <DragCountBadge
                v-if="templateStore.isTemplateSelected(template.id) && templateStore.selectedTemplateIds.size > 1"
                :count="templateStore.selectedTemplateIds.size"
              />

              <button
                class="delete-btn"
                :aria-label="$t('sidebar.deleteTemplate', { label: template.label })"
                @click.stop="handleDelete(template.id)"
                @mousedown.stop
                @pointerdown.stop
              >
                <svg class="delete-icon" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </button>
            </template>
          </div>

          <!-- ＋ 新增鈕：非 .chip-wrapper 故不被當可拖項（draggable:'.chip-wrapper'）。 -->
          <button
            class="add-block-btn"
            type="button"
            :aria-label="$t('sidebar.addTemplate', { name: characterDisplayName(slot.character) })"
            :title="$t('sidebar.addTemplate', { name: characterDisplayName(slot.character) })"
            @click.stop="addAndEdit(slot.character)"
          >
            ＋
          </button>

          <!-- 空庫提示：與 ＋ 鈕同列，僅在沒有任何模板時顯示。 -->
          <span
            v-if="localTemplatesPerSlot[slot.slotIndex].length === 0"
            class="empty-text"
          >
            {{ $t('sidebar.emptyHint') }}
          </span>
        </VueDraggable>
      </div>

      <div v-if="displayIdx < orderedSlots.length - 1" class="group-divider" aria-hidden="true" />
    </div>
  </section>
</template>

<style scoped>
.custom-block-field {
  display: flex;
  flex-direction: column;
  padding: 0.75rem 0;
}

.character-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* 分組標題 */
.group-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.group-color-bar {
  width: 2px;
  height: 0.875rem;
  border-radius: 1px;
  flex-shrink: 0;
  transition: background-color 0.2s ease;
}

.group-label {
  flex: 1;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.72);
  user-select: none;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.group-count {
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1;
  padding: 0.1875rem 0.375rem;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.75);
  letter-spacing: 0;
  flex-shrink: 0;
}

/* 空白佔位 */
.empty-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 2.25rem;
  border: 1px dashed rgba(255, 255, 255, 0.10);
  border-radius: 3px;
}

.empty-text {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.5);
  user-select: none;
  letter-spacing: 0.03em;
}

/* 模板列 */
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

/* 拖曳容器本身需有真實 layout box：display:contents 會移除盒模型，
   使 SortableJS forceFallback 的浮動分身定位數學算錯（分身幾乎不跟手，p7）。
   改用與 .chip-row 相同的 flex-wrap 排列，視覺一致但保有盒模型。 */
.chip-row__draggable {
  display: flex;
  flex-wrap: wrap;
  align-items: center;   /* ＋ 鈕／空庫提示與 chip 垂直置中對齊 */
  gap: 0.375rem;
  width: 100%;
}

.chip-wrapper {
  position: relative;
  display: inline-flex;
}

/* ── 行內命名輸入框：外觀對齊 compact BlockChip（比照 GeneralBlockField）。 ── */
.chip-edit {
  box-sizing: border-box;
  /* 寬度完全由 :style 隨草稿即時撐開（最小＝1 字寬＋內距） */
  height: 2.75rem;               /* 44px，與 compact chip 同高 */
  padding: 0 0.5rem;
  border: 1.5px solid rgba(125, 211, 252, 0.85);
  border-radius: 3px;
  background-color: #1e293b;
  color: #ffffff;
  font-family: var(--app-font-mono, 'JetBrains Mono', 'Fira Code', 'Consolas', ui-monospace),
    'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif;
  font-size: 0.9375rem;          /* 15px，與 compact chip label 一致 */
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.03em;
  caret-color: #22d3ee;
  outline: none;
  box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.2);
}

/* ── ＋ 新增鈕：虛線方框（比照 GeneralBlockField）。 ── */
.add-block-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 2.75rem;               /* 與 compact chip 同高 */
  border-radius: 3px;
  border: 1px dashed rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.5);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}
.add-block-btn:hover,
.add-block-btn:focus-visible {
  border-color: rgba(34, 211, 238, 0.6);
  color: rgba(34, 211, 238, 0.95);
  background: rgba(34, 211, 238, 0.08);
  outline: none;
}

/* 刪除按鈕 */
.delete-btn {
  position: absolute;
  top: -5px;
  right: -5px;
  z-index: 10;
  width: 1.125rem;
  height: 1.125rem;
  padding: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.7);
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
  background: rgba(30, 30, 35, 0.92);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: rgba(239, 68, 68, 0.80);
  cursor: pointer;
}

.chip-wrapper:hover .delete-btn,
.chip-wrapper:focus-within .delete-btn {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.20);
  border-color: rgba(239, 68, 68, 0.70);
  color: #ef4444;
}

.delete-btn:active {
  transform: scale(0.92);
}

.delete-icon {
  width: 0.5rem;
  height: 0.5rem;
}

/* 分組分隔線 */
.group-divider {
  height: 1px;
  margin: 0.75rem 0 0.5rem;
  background: rgba(255, 255, 255, 0.06);
}

@media (prefers-reduced-motion: reduce) {
  .delete-btn {
    transition: opacity 0.1s ease;
    transform: scale(1) !important;
  }
  .group-color-bar {
    transition: none;
  }
}
</style>

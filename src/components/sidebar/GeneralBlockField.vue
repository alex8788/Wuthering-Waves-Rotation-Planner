<script setup lang="ts">
// GeneralBlockField.vue — 側邊欄「通用預設區塊」展示與管理區。
// 資料改由 useGeneralBlockStore 提供（可增刪改、持久化，見 store 註解）。
// 支援：拖到主軸、＋新增後即命名、雙擊重命名、點擊選取（Ctrl 多選）、
//       刪除鈕 / Delete 鍵刪除、多選整組拖曳。顏色固定中性灰、不可改。
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import BlockChip from '@/components/ui/BlockChip.vue'
import { useGeneralBlockStore } from '@/stores/useGeneralBlockStore'
import { useSidebarDragList } from '@/composables/blockDrag/useSidebarDragList'
import type { GeneralBlock } from '@/types/block'

const store = useGeneralBlockStore()

// VueDraggable 需綁一份可寫副本（pull:'clone' 不會排序原清單）；與 store 同步。
const localBlocks = ref<GeneralBlock[]>([...store.blocks])
watch(
  () => store.blocks,
  (next) => { localBlocks.value = [...next] },
  { deep: true },
)

// 拖曳樣板共用 useSidebarDragList；結束時把本地副本自 store 重新同步。
const { dragOptions, cloneToPlaceholder, handleDragEnd, onSidebarDragStart } =
  useSidebarDragList({ restore: () => { localBlocks.value = [...store.blocks] } })

function handleDragStart(event: { oldIndex?: number }): void {
  const block = localBlocks.value[event.oldIndex ?? -1]
  if (!block) return
  // 抓起的區塊在多選集合且選取 >1 → 整組依選取先後順序一起拖；否則只拖這一個。
  if (store.isSelected(block.id) && store.selectedIds.size > 1) {
    const ordered = [...store.selectedIds]
      .map((id) => store.blocks.find((b) => b.id === id))
      .filter((b): b is GeneralBlock => !!b)
    onSidebarDragStart(block, ordered)
  } else {
    onSidebarDragStart(block)
  }
}

// ── 行內命名 / 重命名 ─────────────────────────────────────────
const rootRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const draft = ref('')
// 進入編輯後聚焦輸入框並全選（focus 由 watch 在 DOM 更新後執行）。
watch(editingId, (id) => {
  if (!id) return
  void nextTick(() => {
    const el = rootRef.value?.querySelector<HTMLInputElement>('.chip-edit')
    el?.focus()
    el?.select()
  })
})

function startEdit(block: GeneralBlock): void {
  editingId.value = block.id
  draft.value = block.label
}

let finishing = false
function commitEdit(): void {
  if (finishing || editingId.value === null) return
  finishing = true
  store.updateLabel(editingId.value, draft.value) // 空字串＝刪除（store 內處理）
  editingId.value = null
  finishing = false
}
function cancelEdit(): void {
  if (finishing || editingId.value === null) return
  finishing = true
  const id = editingId.value
  editingId.value = null
  finishing = false
  // 若是剛新增卻未命名（store 內仍為空 label）→ 順手刪除避免殘留空塊。
  const b = store.blocks.find((x) => x.id === id)
  if (b && b.label.trim() === '') store.deleteBlock(id)
}
function onEditKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') { event.preventDefault(); commitEdit() }
  else if (event.key === 'Escape') { event.preventDefault(); cancelEdit() }
}

// ＋ 新增：建一個空 label 區塊，立即進入命名。
function addAndEdit(): void {
  const id = store.addBlock()
  const block = store.blocks.find((b) => b.id === id)
  if (block) startEdit(block)
}

// ── 點擊選取（Ctrl/Cmd 多選；再點同一個取消） ─────────────────
function handleClick(block: GeneralBlock, event: MouseEvent): void {
  if (editingId.value !== null) return
  store.toggleSelection(block.id, event.ctrlKey || event.metaKey)
}

function handleDelete(id: string): void {
  store.deleteBlock(id)
}

// Delete/Backspace：有選取時批量刪除；capture + stopPropagation 擋掉主軸全域快捷鍵。
function onKeydownCapture(event: KeyboardEvent): void {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (store.selectedIds.size === 0) return
  const target = event.target as HTMLElement
  const tag = target?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
  event.preventDefault()
  event.stopPropagation()
  store.deleteSelected()
}

onMounted(() => window.addEventListener('keydown', onKeydownCapture, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydownCapture, true)
  store.clearSelection()
})
</script>

<template>
  <section ref="rootRef" class="general-block-field">
    <h3 class="field-title">{{ $t('sidebar.generalBlocks') }}</h3>
    <div class="chip-row">
      <VueDraggable
        v-model="localBlocks"
        item-key="id"
        tag="div"
        class="chip-row__draggable"
        :clone="cloneToPlaceholder"
        v-bind="dragOptions"
        @start="handleDragStart"
        @end="handleDragEnd"
      >
        <div
          v-for="block in localBlocks"
          :key="block.id"
          class="chip-wrapper"
          @click.stop="handleClick(block, $event)"
          @dblclick.stop="startEdit(block)"
        >
          <!-- 命名 / 重命名：以輸入框取代 chip。 -->
          <input
            v-if="editingId === block.id"
            v-model="draft"
            class="chip-edit"
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
              :label="block.label"
              :color="block.color"
              :is-selected="store.isSelected(block.id)"
              compact
            />
            <button
              class="delete-btn"
              :aria-label="$t('sidebar.deleteGeneralBlock', { label: block.label })"
              @click.stop="handleDelete(block.id)"
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
          :aria-label="$t('sidebar.addGeneralBlock')"
          :title="$t('sidebar.addGeneralBlock')"
          @click.stop="addAndEdit"
        >
          ＋
        </button>
      </VueDraggable>
    </div>
  </section>
</template>

<style scoped>
.general-block-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;         /* 標題與區塊列之間的間距 */
  padding: 0.75rem 0;  /* 上下呼吸空間，左右由父層 SidebarPanel 控制 */
}
/* ── 區塊標題 ── */
.field-title {
  margin: 0;
  font-size: 0.6875rem;    /* 11px，刻意縮小以不搶區塊視覺焦點 */
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);  /* 極淡，作為標籤而非主要內容 */
  user-select: none;
}
/* ── 橫向換行排列 ── */
.chip-row {
  display: flex;
  flex-wrap: wrap;    /* 超出寬度自動換行 */
  gap: 0.375rem;      /* 區塊間距：6px，緊湊但有呼吸感 */
}
/* 拖曳容器本身需有真實 layout box：display:contents 會移除盒模型，
   使 SortableJS forceFallback 的浮動分身定位數學算錯（分身幾乎不跟手，p7）。
   改用與 .chip-row 相同的 flex-wrap 排列，視覺一致但保有盒模型。
   align-items:center 讓 ＋ 鈕與 chip 垂直置中對齊。 */
.chip-row__draggable {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
}

/* chip 外層包裝：無 transform 盒模型（拖曳分身放大套在內層 chip 盒上），
   並作為刪除鈕的定位基準。 */
.chip-wrapper {
  position: relative;
  display: inline-flex;
}

/* ── 行內命名輸入框：外觀對齊 compact BlockChip（灰底、置中、15px）。 ── */
.chip-edit {
  box-sizing: border-box;
  width: 3.75rem;
  height: 2.75rem;               /* 44px，與 compact chip 同高 */
  padding: 0 0.5rem;
  border: 1.5px solid rgba(125, 211, 252, 0.85);
  border-radius: 3px;
  background-color: #1e293b;
  color: #ffffff;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', ui-monospace,
    'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif;
  font-size: 0.9375rem;          /* 15px，與 compact chip label 一致 */
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.03em;
  caret-color: #22d3ee;
  outline: none;
  box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.2);
}

/* ── ＋ 新增鈕：虛線方框，比照主軸 ＋ 的中性風格。 ── */
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

/* ── 刪除鈕：懸停 / 聚焦時浮現（比照 CustomBlockField）。 ── */
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

@media (prefers-reduced-motion: reduce) {
  .delete-btn {
    transition: opacity 0.1s ease;
    transform: scale(1) !important;
  }
}
</style>

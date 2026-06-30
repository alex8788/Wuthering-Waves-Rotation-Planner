<script setup lang="ts">
// ============================================================
// RotationAxisTabBar.vue
// 底部「輸出軸」頁籤列（類似 Excel 工作表分頁）。
//   - 點擊頁籤 → 切換作用中輸出軸
//   - 雙擊頁籤 → 行內改名（Enter 提交 / Esc 取消 / 失焦提交）
//   - 頁籤右側 ×  → 刪除（僅一條軸時隱藏）
//   - 末端 ＋   → 新增輸出軸（彈出名稱輸入對話框，游標自動聚焦）
// ============================================================

import { nextTick, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useRotationStore } from '@/stores/useRotationStore'
import { useDialog } from '@/composables/useDialog'

const rotationStore = useRotationStore()
const { confirm, prompt } = useDialog()

// 行內改名狀態：editingId 指向正在改名的軸，draft 為輸入草稿。
const editingId = ref<string | null>(null)
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 行內改名輸入框在 v-for 內，靜態 ref 會被收集成陣列 → 改用 callback ref
// 穩定取得單一元素（v-if 同時只渲染一個）。
function setInputRef(el: Element | ComponentPublicInstance | null): void {
  inputRef.value = el as HTMLInputElement | null
}

function selectAxis(id: string): void {
  if (id !== rotationStore.activeAxisId) rotationStore.setActiveAxis(id)
}

function startRename(id: string, currentName: string): void {
  editingId.value = id
  draft.value = currentName
  void nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

function commitRename(): void {
  if (editingId.value === null) return
  rotationStore.renameAxis(editingId.value, draft.value)
  editingId.value = null
}

function cancelRename(): void {
  editingId.value = null
}

async function addAxis(): Promise<void> {
  const defaultName = `輸出軸 ${rotationStore.axes.length + 1}`
  const name = await prompt({
    title: '新增輸出軸',
    placeholder: '輸出軸名稱',
    defaultValue: defaultName,
    confirmText: '建立',
  })
  if (name === null) return // 取消
  const trimmed = name.trim()
  rotationStore.addAxis(trimmed === '' ? defaultName : trimmed)
}

async function removeAxis(id: string, name: string): Promise<void> {
  const ok = await confirm({
    title: '刪除輸出軸',
    message: `確定刪除「${name}」？`,
    confirmText: '刪除',
    danger: true,
  })
  if (ok) rotationStore.deleteAxis(id)
}
</script>

<template>
  <div class="axis-tabbar" role="tablist" aria-label="輸出軸分頁">
    <button
      v-for="axis in rotationStore.axes"
      :key="axis.id"
      type="button"
      role="tab"
      class="axis-tab"
      :class="{ 'axis-tab--active': axis.id === rotationStore.activeAxisId }"
      :aria-selected="axis.id === rotationStore.activeAxisId"
      @click="selectAxis(axis.id)"
      @dblclick="startRename(axis.id, axis.name)"
    >
      <input
        v-if="editingId === axis.id"
        :ref="setInputRef"
        v-model="draft"
        class="axis-tab__input"
        type="text"
        @click.stop
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename"
      />
      <template v-else>
        <span class="axis-tab__name">{{ axis.name }}</span>
        <span
          v-if="rotationStore.axes.length > 1"
          class="axis-tab__close"
          role="button"
          aria-label="刪除輸出軸"
          title="刪除輸出軸"
          @click.stop="removeAxis(axis.id, axis.name)"
        >×</span>
      </template>
    </button>

    <button
      type="button"
      class="axis-tab axis-tab--add"
      aria-label="新增輸出軸"
      title="新增輸出軸"
      @click="addAxis"
    >＋</button>
  </div>
</template>

<style scoped>
.axis-tabbar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px 8px 0;
  min-height: 2.25rem;
  overflow-x: auto;
  overflow-y: hidden;
}

.axis-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex: 0 0 auto;
  max-width: 14rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background-color: #131b2e;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.8125rem;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.axis-tab:hover {
  background-color: #1b2740;
  color: rgba(255, 255, 255, 0.82);
}

.axis-tab--active {
  background-color: #0A0F1E;
  color: rgba(34, 211, 238, 0.95);
  border-color: rgba(34, 211, 238, 0.45);
}

.axis-tab:focus-visible {
  outline: none;
  border-color: rgba(34, 211, 238, 0.55);
}

.axis-tab__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.axis-tab__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.45);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.axis-tab__close:hover {
  background-color: rgba(248, 113, 113, 0.22);
  color: rgba(248, 113, 113, 0.95);
}

.axis-tab__input {
  width: 8rem;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(34, 211, 238, 0.95);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
}

.axis-tab--add {
  color: rgba(255, 255, 255, 0.5);
  font-size: 1rem;
  padding: 0.35rem 0.6rem;
}

.axis-tabbar::-webkit-scrollbar {
  height: 6px;
}
.axis-tabbar::-webkit-scrollbar-thumb {
  background-color: rgba(34, 211, 238, 0.18);
  border-radius: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .axis-tab {
    transition: none;
  }
}
</style>

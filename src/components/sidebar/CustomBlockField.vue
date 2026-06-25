<script setup lang="ts">
// CustomBlockField.vue
// 側邊欄「自訂模板」展示區，依目前三條泳道選中的角色即時分組顯示。
// 不靠父層傳資料，自己讀角色與模板兩個 store，是個獨立運作的面板。
import { ref, computed, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import BlockChip from '@/components/ui/BlockChip.vue'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useBlockDrag, DROP_ZONE_ATTRIBUTE } from '@/composables/useBlockDrag'
import type { TemplateBlock } from '@/types/block'

const sidebarStore = useSidebarStore()
const characterStore = useCharacterStore()
const { dragState, onSidebarDragStart, getSidebarSortableOptions } = useBlockDrag()

// 三個槽位各自的模板列表，未選角的槽位給空陣列
const slotTemplates = computed(() =>
  characterStore.slots.map((slot) =>
    slot.character ? sidebarStore.getTemplatesByCharacter(slot.character.id) : []
  )
)

// 套件要拖曳的清單要綁定能自己操作的陣列，所以另外存一份本地緩衝，
// 新增/刪除模板時跟著 slotTemplates 重新同步
const localTemplatesPerSlot = ref<TemplateBlock[][]>(slotTemplates.value.map((t) => [...t]))
watch(slotTemplates, (next) => {
  localTemplatesPerSlot.value = next.map((t) => [...t])
})

const dragOptions = computed(() => getSidebarSortableOptions())

// 拖去主軸時，先包成「看起來像主軸區塊」的暫時資料，避免畫面在
// 正式寫入 store 前因為資料形狀不對而報錯。
// id 改用 dragState.pendingInstanceId（拖曳開始時已預先產生），確保
// 之後正式寫入 store 的資料與這個暫時物件共用同一個 id，:key 全程不變。
function cloneToPlaceholder(original: TemplateBlock) {
  return {
    id: dragState.pendingInstanceId ?? original.id,
    slotIndex: 0,
    block: { ...original },
  }
}

function handleDragStart(idx: number, event: { oldIndex?: number }): void {
  const template = localTemplatesPerSlot.value[idx]?.[event.oldIndex ?? -1]
  if (template) onSidebarDragStart(template)
}

function handleDelete(templateId: string): void {
  sidebarStore.deleteTemplate(templateId)
}
</script>

<template>
  <section class="custom-block-field">
    <div
      v-for="(slot, idx) in characterStore.slots"
      :key="slot.slotIndex"
      class="character-group"
    >
      <div class="group-header">
        <span
          class="group-color-bar"
          :style="{ backgroundColor: slot.character?.themeColor ?? 'rgba(255,255,255,0.18)' }"
          aria-hidden="true"
        />
        <span class="group-label">
          {{ slot.character?.nameZh ?? '角色 ' + (slot.slotIndex + 1) }}
        </span>

        <span
          v-if="localTemplatesPerSlot[idx].length > 0"
          class="group-count"
          :aria-label="`共 ${localTemplatesPerSlot[idx].length} 個模板`"
        >
          {{ localTemplatesPerSlot[idx].length }}
        </span>
      </div>

      <div v-if="!slot.character" class="empty-placeholder" aria-label="尚未選角，無法顯示自訂模板">
        <span class="empty-text">尚未選角</span>
      </div>

      <div
        v-else-if="localTemplatesPerSlot[idx].length === 0"
        class="empty-placeholder empty-placeholder--hint"
        aria-label="此角色尚無自訂模板"
      >
        <span class="empty-text">從主軸拖回區塊以新增模板</span>
      </div>

      <div v-else class="chip-row" :aria-label="`${slot.character.nameZh} 的自訂模板`">
        <VueDraggable
          v-model="localTemplatesPerSlot[idx]"
          item-key="id"
          tag="div"
          class="chip-row__draggable"
          :clone="cloneToPlaceholder"
          :[DROP_ZONE_ATTRIBUTE]="true"
          v-bind="dragOptions"
          @start="(e: { oldIndex?: number }) => handleDragStart(idx, e)"
        >
          <div v-for="template in localTemplatesPerSlot[idx]" :key="template.id" class="chip-wrapper">
            <BlockChip :label="template.label" :color="template.color" />

            <button
              class="delete-btn"
              :aria-label="`刪除模板 ${template.label}`"
              @click.stop="handleDelete(template.id)"
            >
              <svg class="delete-icon" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </button>
          </div>
        </VueDraggable>
      </div>

      <div v-if="idx < characterStore.slots.length - 1" class="group-divider" aria-hidden="true" />
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
  color: rgba(255, 255, 255, 0.40);
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
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.45);
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

.empty-placeholder--hint {
  border-color: rgba(255, 255, 255, 0.07);
}

.empty-text {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.22);
  user-select: none;
  letter-spacing: 0.03em;
}

/* 模板列 */
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

/* 讓拖曳容器在版面上「隱形」，chip-wrapper 直接參與 .chip-row 的排列 */
.chip-row__draggable {
  display: contents;
}

.chip-wrapper {
  position: relative;
  display: inline-flex;
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

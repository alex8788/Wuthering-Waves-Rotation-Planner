<script setup lang="ts">
// DefaultBlockField.vue — 側邊欄「預設區塊」展示區。
// 只負責「被拖出去」到主軸：清單本身不可排序、不接受拖入。
import { ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import BlockChip from '@/components/ui/BlockChip.vue'
import { DEFAULT_BLOCKS } from '@/constants/defaultBlocks'
import { useSidebarDragList } from '@/composables/blockDrag/useSidebarDragList'
import type { DefaultBlock } from '@/types/block'

// 套件要求綁定一個它能自行操作的陣列，不能直接綁常數。
// 這份清單不會被排序也不接受拖入，所以不需要額外同步機制。
const localBlocks = ref<DefaultBlock[]>([...DEFAULT_BLOCKS])

// 拖曳樣板（dragOptions / clone 偽裝 / 結束還原）共用 useSidebarDragList（R3）
const { dragOptions, cloneToPlaceholder, handleDragEnd, onSidebarDragStart } =
  useSidebarDragList({ restore: () => { localBlocks.value = [...DEFAULT_BLOCKS] } })

function handleDragStart(event: { oldIndex?: number }): void {
  const block = localBlocks.value[event.oldIndex ?? -1]
  if (block) onSidebarDragStart(block)
}
</script>

<template>
  <section class="default-block-field">
    <h3 class="field-title">{{ $t('sidebar.defaultBlocks') }}</h3>
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
        <BlockChip
          v-for="block in localBlocks"
          :key="block.id"
          :label="block.label"
          :color="block.color"
          compact
        />
      </VueDraggable>
    </div>
  </section>
</template>

<style scoped>
.default-block-field {
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
   改用與 .chip-row 相同的 flex-wrap 排列，視覺一致但保有盒模型。 */
.chip-row__draggable {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  width: 100%;
}
</style>
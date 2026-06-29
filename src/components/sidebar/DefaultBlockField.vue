<script setup lang="ts">
// DefaultBlockField.vue
// 側邊欄「預設區塊」展示區。
// Phase 4.3：補上拖曳出去到主軸的功能。這份清單本身不能被排序、
// 也不接受任何東西拖進來，只負責「被拖出去」。
import { ref, computed } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import BlockChip from '@/components/ui/BlockChip.vue'
import { DEFAULT_BLOCKS } from '@/constants/defaultBlocks'
import { useBlockDrag } from '@/composables/useBlockDrag'
import type { DefaultBlock } from '@/types/block'

const { getOrCreatePendingInstanceId, onSidebarDragStart, getSidebarSortableOptions, handleDragEnd: _handleDragEnd } = useBlockDrag()

function handleDragEnd(): void {
  localBlocks.value = [...DEFAULT_BLOCKS]
  _handleDragEnd()
}

// 套件要求綁定一個它能自行操作的陣列，不能直接綁常數。
// 這份清單不會被排序也不接受拖入，所以不需要額外同步機制。
const localBlocks = ref<DefaultBlock[]>([...DEFAULT_BLOCKS])

const dragOptions = computed(() => getSidebarSortableOptions())

// 拖去其他清單時，把原始區塊包成「看起來像主軸區塊」的暫時資料，
// 避免畫面在正式寫入 store 前因為資料形狀不對而報錯。
// id 改用 dragState.pendingInstanceId（拖曳開始時已預先產生），而非
// 側邊欄原始 block 的固定 id：確保之後正式寫入 store 的資料與這個
// 暫時物件共用同一個 id，:key 全程不變，也避免跟主軸上同款區塊撞號。
function cloneToPlaceholder(original: DefaultBlock) {
  return {
    id: getOrCreatePendingInstanceId(),
    slotIndex: 0,
    block: { ...original },
  }
}

function handleDragStart(event: { oldIndex?: number }): void {
  const block = localBlocks.value[event.oldIndex ?? -1]
  if (block) onSidebarDragStart(block)
}
</script>

<template>
  <section class="default-block-field">
    <h3 class="field-title">基礎招式</h3>
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
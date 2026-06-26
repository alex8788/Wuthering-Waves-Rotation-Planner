<script setup lang="ts">
// RotationBlock.vue：主時間軸區塊的純展示層 (Dumb Component)
// 職責：僅負責 UI 渲染與事件上拋。不依賴 Store，選取與警告狀態均由父層 (Swimlane) 傳入。

import { ref } from 'vue'
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
  /** 危險狀態 (懸停於無效區的紅色警告) */
  isDanger?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isSelected: false,
  isDanger: false,
})

const emit = defineEmits<{
  /** 點擊選取。上拋原始 MouseEvent 供父層處理 Ctrl/Meta 多選邏輯 */
  select: [event: MouseEvent]
}>()

// 本地 UI 狀態 (僅供 hover 視覺反饋)
const isHovered = ref(false)

// 點擊事件：阻擋冒泡並將原始事件上拋
function handleClick(event: MouseEvent): void {
  event.stopPropagation()
  emit('select', event)
}
</script>

<template>
  <div
    class="rotation-block"
    :data-entry-id="entryId"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @click="handleClick"
  >
    <BlockChip
      :label="label"
      :color="color"
      :is-hovered="isHovered && !isSelected"
      :is-selected="isSelected"
      :is-danger="isDanger"
    />
  </div>
</template>

<style scoped>
/* 隱藏外層包裝盒模型，避免破壞 flex 排版 */
.rotation-block {
  display: inline-flex;;
}
</style>
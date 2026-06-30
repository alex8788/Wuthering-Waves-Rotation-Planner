<script setup lang="ts">
// ============================================================
// RotationExportView.vue
// 圖片匯出專用的「乾淨」視圖：依單一輸出軸資料重繪,不含 ＋鈕、
// 拖曳把手、選取高亮、捲軸 —— 純粹給點陣化截圖用。
//
// 版面:左上角軸名,下方三條完整展開的泳道(含泳道 header)。
// 三泳道的「時間欄」對齊靠 CSS subgrid:父格定義所有欄,每條泳道
// 為跨全欄的 subgrid,故同一欄(同一時間點)在三泳道間寬度一致、
// 垂直對齊(等同主面板的共用 grid,但免去 JS 量測)。
//
// 區塊複用 BlockChip(純視覺),顏色用泳道角色屬性色(getElementColor),
// 與主面板完全一致。
// ============================================================

import { computed } from 'vue'
import BlockChip from '@/components/ui/BlockChip.vue'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useLaneOrder } from '@/composables/useLaneOrder'
import { getElementColor } from '@/constants/elements'
import type { RotationAxis, RotationEntry } from '@/types/rotation'
import type { SlotIndex } from '@/types/character'

const props = defineProps<{ axis: RotationAxis }>()

const characterStore = useCharacterStore()
const { laneOrder } = useLaneOrder()

// 全域欄數＝該軸 1D 陣列長度(每個 entry 佔一欄,跨泳道共用同一時間軸)。
const columnCount = computed<number>(() => props.axis.entries.length)

// id → 全域欄序(在 1D 陣列中的 index)。
const idToColumn = computed<Map<string, number>>(() => {
  const m = new Map<string, number>()
  props.axis.entries.forEach((e, i) => m.set(e.id, i))
  return m
})

// 依 slotIndex 把 entries 分到三條泳道(各自維持時間順序)。
const entriesBySlot = computed<Record<SlotIndex, RotationEntry[]>>(() => {
  const map: Record<SlotIndex, RotationEntry[]> = { 0: [], 1: [], 2: [] }
  for (const e of props.axis.entries) map[e.slotIndex as SlotIndex].push(e)
  return map
})

// 泳道垂直顯示順序沿用全域 laneOrder,與主面板一致。
const orderedSlots = computed<SlotIndex[]>(() => laneOrder.value)

function laneCharacter(slot: SlotIndex) {
  return characterStore.slotCharacters[slot]
}
function laneColor(slot: SlotIndex): string {
  return getElementColor(characterStore.slotCharacters[slot]?.element)
}
</script>

<template>
  <div class="export-view">
    <div class="export-view__title">{{ axis.name }}</div>

    <div
      class="export-view__lanes"
      :style="{ '--col-count': columnCount }"
    >
      <div
        v-for="slot in orderedSlots"
        :key="slot"
        class="export-lane"
      >
        <!-- 泳道 header:色條 + 角色名 + 屬性 -->
        <div class="export-lane__header">
          <div
            class="export-lane__bar"
            :style="{ backgroundColor: laneCharacter(slot) ? laneColor(slot) : 'rgba(255,255,255,0.15)' }"
          />
          <div class="export-lane__name" :class="{ 'export-lane__name--empty': !laneCharacter(slot) }">
            {{ laneCharacter(slot)?.nameZh ?? '未選角' }}
          </div>
          <div
            v-if="laneCharacter(slot)"
            class="export-lane__element"
            :style="{ color: laneColor(slot) }"
          >
            {{ laneCharacter(slot)?.element }}
          </div>
        </div>

        <!-- 區塊:依全域欄序釘在共用 subgrid 上(欄 1 為 header,故 +2) -->
        <BlockChip
          v-for="entry in entriesBySlot[slot]"
          :key="entry.id"
          class="export-lane__block"
          :label="entry.block.label"
          :color="laneColor(slot)"
          :style="{ gridColumn: String(idToColumn.get(entry.id)! + 2) }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.export-view {
  display: inline-block;
  padding: 2rem 2.25rem;
  background-color: #0A0F1E;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

.export-view__title {
  margin-bottom: 1.125rem;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(34, 211, 238, 0.95);
}

/* 父格:欄 1 = header(max-content),其後 N 欄 = 時間欄(各自 max-content) */
.export-view__lanes {
  display: grid;
  grid-template-columns: max-content repeat(var(--col-count), max-content);
  column-gap: 4px;
  row-gap: 8px;
}

/* 每條泳道 = 跨全欄的 subgrid → 同欄在三泳道間對齊 */
.export-lane {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  min-height: 4rem;
  background-color: rgba(255, 255, 255, 0.015);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.export-lane__header {
  position: relative;
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.2rem;
  width: 8.5rem;
  height: 100%;
  padding: 0 0.75rem;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
}

.export-lane__bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 4px 4px 0 0;
}

.export-lane__name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: rgba(240, 244, 248, 0.95);
  white-space: nowrap;
}

.export-lane__name--empty {
  color: rgba(240, 244, 248, 0.4);
}

.export-lane__element {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.export-lane__block {
  grid-row: 1;
  cursor: default;
}
</style>

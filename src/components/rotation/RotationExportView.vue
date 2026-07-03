<script setup lang="ts">
// ============================================================
// RotationExportView.vue — 圖片匯出專用的乾淨視圖（給點陣化截圖）。
//
// 設計原則：
//   - 依單一輸出軸重繪，不含 ＋鈕/拖曳把手/選取高亮/捲軸。
//   - 三泳道時間欄對齊靠 CSS subgrid（父格定義所有欄），免 JS 量測。
//   - 區塊複用 BlockChip，顏色用屬性色（getElementColor），與主面板一致。
// ============================================================

import { computed } from 'vue'
import BlockChip from '@/components/ui/BlockChip.vue'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useLaneOrder } from '@/composables/state/useLaneOrder'
import { useLaneLayout } from '@/composables/board/useLaneLayout'
import { getElementColor } from '@/constants/elements'
import { TRACK_GAP_PX } from '@/constants/layout'
import type { RotationAxis } from '@/types/rotation'
import type { SlotIndex } from '@/types/character'

const props = defineProps<{ axis: RotationAxis }>()

const characterStore = useCharacterStore()
const { laneOrder } = useLaneOrder()

// 全域欄數＝該軸 1D 陣列長度(每個 entry 佔一欄,跨泳道共用同一時間軸)。
const columnCount = computed<number>(() => props.axis.entries.length)

// 泳道分流與 id→全域欄序：與主面板共用 useLaneLayout（R2）。
const { entriesBySlot, idToColumn } = useLaneLayout(() => props.axis.entries)

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
      :style="{ '--col-count': columnCount, '--track-gap': `${TRACK_GAP_PX}px` }"
    >
      <div
        v-for="slot in orderedSlots"
        :key="slot"
        class="export-lane"
      >
        <!-- 泳道 header:左側色條 + 頭像(左) + 名稱(右)（對齊主面板版型） -->
        <div class="export-lane__header">
          <div
            class="export-lane__bar"
            :style="{ backgroundColor: laneCharacter(slot) ? laneColor(slot) : 'rgba(255,255,255,0.15)' }"
          />

          <div class="export-lane__identity">
            <template v-if="laneCharacter(slot)">
              <img
                v-if="laneCharacter(slot)?.avatar"
                class="export-lane__avatar"
                :src="laneCharacter(slot)!.avatar!"
                :alt="laneCharacter(slot)?.nameZh"
              />
              <div v-else class="export-lane__avatar export-lane__avatar--placeholder" />
              <span class="export-lane__name">{{ laneCharacter(slot)?.nameZh }}</span>
            </template>
            <span v-else class="export-lane__name export-lane__name--empty">未選角</span>
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

/* 父格:欄 1 = header(max-content),其後 N 欄 = 時間欄(各自 max-content)。
   column-gap 用注入的 --track-gap（單一來源），與主面板泳道間距一致。 */
.export-view__lanes {
  display: grid;
  grid-template-columns: max-content repeat(var(--col-count), max-content);
  column-gap: var(--track-gap, 4px);
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
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  /* 寬度不再寫死：grid 欄 1 為 max-content，會依三泳道最長 header 自動撐寬（動態）。
     設下限避免短名時過窄，上限避免長名把圖片撐爆。 */
  min-width: 9rem;
  max-width: 16rem;
  height: 100%;
  padding: 0 0.6rem 0 0.7rem; /* 左緣留空給垂直色條 */
  border-right: 1px solid rgba(255, 255, 255, 0.07);
}

/* 左側垂直色條（對齊主面板）。 */
.export-lane__bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  border-radius: 4px 0 0 4px;
}

/* 角色欄：頭像（左）+ 名稱（右，靠右對齊）。 */
.export-lane__identity {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
}
.export-lane__avatar {
  flex-shrink: 0;
  width: 2.9rem;
  height: 2.9rem;
  border-radius: 6px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.export-lane__name {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.1;
  color: rgba(240, 244, 248, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.export-lane__name--empty {
  color: rgba(240, 244, 248, 0.4);
}

.export-lane__block {
  grid-row: 1;
  cursor: default;
}
</style>

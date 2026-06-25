<script setup lang="ts">
// ============================================================
// RotationBoard.vue
// 主時間軸面板：三條 Swimlane 的總容器。
//
// 職責：
//   1. 從 useCharacterStore 讀取三個角色槽的選角狀態。
//   2. 從 useRotationStore 讀取 1D 輸出軸陣列（entries）。
//   3. 將 1D 陣列依 slotIndex 過濾，分別傳入對應的 Swimlane。
//   4. 假資料驗證：初始化時注入測試用 RotationEntry，確認 Store 資料能正確渲染到泳道。
//
// 版面結構：
//   ┌──────────────────────────────────────────────┐
//   │  Swimlane (slotIndex = 0)                    │
//   ├──────────────────────────────────────────────┤
//   │  Swimlane (slotIndex = 1)                    │
//   ├──────────────────────────────────────────────┤
//   │  Swimlane (slotIndex = 2)                    │
//   └──────────────────────────────────────────────┘
//
// 嚴格限制：
//   本元件為靜態殼層，不處理拖曳邏輯。
//   所有渲染邏輯限於「讀取 store → 分配資料 → 傳入 Swimlane」三步驟。
// ============================================================

import { computed, onMounted } from 'vue'
import Swimlane from '@/components/rotation/Swimlane.vue'
import { useCharacterStore } from '@/stores/useCharacterStore'
import { useRotationStore } from '@/stores/useRotationStore'
import { DELETE_ZONE_ATTRIBUTE } from '@/composables/useBlockDrag'
import type { SlotIndex } from '@/types/character'
import type { RotationEntry } from '@/types/rotation'

// ── Stores ───────────────────────────────────────────────────

const characterStore = useCharacterStore()
const rotationStore  = useRotationStore()

// ── Computed：依 slotIndex 分配 entries ─────────────────────

/**
 * entriesBySlot：將 1D 陣列依 slotIndex 過濾成三份子陣列。
 *
 * 設計說明：
 *   三條泳道的過濾結果來自同一個 computed，避免三個各自獨立的
 *   computed 對 entries 做三次全量掃描。
 *   使用 Map 讓分組一次完成，整體為 O(N)。
 */
const entriesBySlot = computed<Record<SlotIndex, RotationEntry[]>>(() => {
  const map: Record<SlotIndex, RotationEntry[]> = { 0: [], 1: [], 2: [] }
  for (const entry of rotationStore.entries) {
    map[entry.slotIndex as SlotIndex].push(entry)
  }
  return map
})

// ── 假資料初始化（Store 驗證用）────────────────────────────

/**
 * seedStoreWithStubData：
 *   在 onMounted 時向 rotationStore 注入假資料，
 *   驗證「Store → 過濾 → Swimlane 渲染」這條資料路徑是否正常。
 *
 *   條件：只在 store 為空時執行，避免重複注入或覆蓋使用者資料。
 *   後續 Phase 完成選角 UI 後可移除此函式。
 */
function seedStoreWithStubData(): void {
  if (rotationStore.entries.length > 0) return

  // 取得三個槽位的角色（可能為 null）
  const chars = characterStore.slotCharacters

  // 為每個有角色的槽位注入數個測試區塊
  const stubLabels = [
    ['A', '3AE', 'E', 'R', 'A'],   // slot 0
    ['E', 'Z',   'A', 'EQ'],        // slot 1
    ['3A', 'R',  'D', 'A', 'E'],   // slot 2
  ] as const

  stubLabels.forEach((labels, idx) => {
    const slotIndex = idx as SlotIndex
    const char = chars[idx]
    if (!char) return // 槽位無角色，跳過

    labels.forEach((label) => {
      rotationStore.addFreeformBlock(
        label,
        char.themeColor,
        slotIndex,
        char.id,
      )
    })
  })
}

onMounted(() => {
  // 為了在開發階段能立即看到三條泳道有資料，
  // 先預設選入三位角色（僅當槽位為空時），再注入假區塊。
  const slots = characterStore.slots
  if (!slots[0].character) characterStore.setCharacter(0, 'jiyan')
  if (!slots[1].character) characterStore.setCharacter(1, 'verina')
  if (!slots[2].character) characterStore.setCharacter(2, 'shorekeeper')

  seedStoreWithStubData()
})
</script>

<template>
  <section
    class="rotation-board"
    :[DELETE_ZONE_ATTRIBUTE]="true"
    aria-label="輸出軸面板"
  >

    <!--
      三條泳道：依 slotIndex 0 / 1 / 2 順序渲染。
      character 與 entries 皆從 store computed 中取得，
      Swimlane 本身不直接存取任何 store。
    -->
    <Swimlane
      v-for="slot in characterStore.slots"
      :key="slot.slotIndex"
      :slot-index="slot.slotIndex"
      :character="slot.character"
      :entries="entriesBySlot[slot.slotIndex]"
    />

  </section>
</template>

<style scoped>
/* ── 三軸容器 ────────────────────────────────────────────── */
.rotation-board {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;

  /* 外框：與整體 UI 深色底的邊界 */
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 6px;
  overflow: hidden;           /* 讓第一/最後條 Swimlane 的 border-radius 生效 */

  background: rgba(255, 255, 255, 0.015);
}
</style>

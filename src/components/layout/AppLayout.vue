<script setup lang="ts">
// ============================================================
// AppLayout.vue
// 整體版面框架：上方 Header（固定高度）＋ 左側 Sidebar（固定寬度，
// 內部可垂直捲動）＋ 右側 Main（佔滿剩餘空間，可雙向捲動）。
//
// 純版面殼層元件：不持有任何業務狀態，三個區域的實際內容
// 完全透過具名 slot（header / sidebar / main）由外部注入。
// ============================================================

interface Props {
  /** 側邊欄固定寬度（px） */
  sidebarWidth?: number
  /** 頂部 Header 固定高度（px） */
  headerHeight?: number
}

const props = withDefaults(defineProps<Props>(), {
  sidebarWidth: 300,
  headerHeight: 64,
})
</script>

<template>
  <div
    class="app-layout"
    :style="{
      '--app-sidebar-width': `${props.sidebarWidth}px`,
      '--app-header-height': `${props.headerHeight}px`,
    }"
  >
    <!-- 標題列與側邊欄皆屬「禁止放置區」：不掛任何 drop/delete 屬性，
         游標在此 → _handleDragOver 判定為禁止放置（顯示禁止圖標、放開彈回） -->
    <div class="app-layout__header">
      <slot name="header" />
    </div>

    <div class="app-layout__sidebar">
      <slot name="sidebar" />
    </div>

    <div class="app-layout__main">
      <slot name="main" />
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: var(--app-sidebar-width) 1fr;
  grid-template-rows: var(--app-header-height) 1fr;
  grid-template-areas:
    'header header'
    'sidebar main';

  width: 100vw;
  height: 100vh;
  /* 整頁不捲動，捲動行為交由各子區域自行決定 */
  overflow: hidden;
  background-color: #0A0F1E;
}

.app-layout__header {
  grid-area: header;
  /* Header 內容不應撐爆固定高度的格子 */
  min-width: 0;
  overflow: hidden;
}

.app-layout__sidebar {
  grid-area: sidebar;
  /* min-height: 0 是 Grid item 內部能正確捲動的關鍵，
     否則子內容會撐開格子高度而失去 overflow 效果 */
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background-color: #0D1320;
}

.app-layout__main {
  grid-area: main;
  min-width: 0;
  min-height: 0;
  /* 主時間軸可能因區塊數量而超出視窗，需雙向捲動 */
  overflow: auto;
  background-color: #0A0F1E;
}

/* ── 側邊欄 / 主軸共用：細緻科幻風格捲軸 ───────────────────── */
.app-layout__sidebar::-webkit-scrollbar,
.app-layout__main::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.app-layout__sidebar::-webkit-scrollbar-track,
.app-layout__main::-webkit-scrollbar-track {
  background: transparent;
}
.app-layout__sidebar::-webkit-scrollbar-thumb,
.app-layout__main::-webkit-scrollbar-thumb {
  background-color: rgba(34, 211, 238, 0.18);
  border-radius: 4px;
}
.app-layout__sidebar::-webkit-scrollbar-thumb:hover,
.app-layout__main::-webkit-scrollbar-thumb:hover {
  background-color: rgba(34, 211, 238, 0.32);
}
</style>

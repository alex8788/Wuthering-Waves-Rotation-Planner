<script setup lang="ts">
// ============================================================
// AppLayout.vue
// 整體版面框架：上方 Header（固定高度）＋ 左側 Sidebar（固定寬度，
// 內部可垂直捲動）＋ 右側 Main（佔滿剩餘空間，可雙向捲動）。
//
// 純版面殼層元件：不持有任何業務狀態，三個區域的實際內容
// 完全透過具名 slot（header / sidebar / main）由外部注入。
// ============================================================

import { computed } from 'vue'
import { useSidebarCollapse } from '@/composables/useSidebarCollapse'

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

// 側邊欄收合：收合時欄寬過渡成一條細「軌道」（仍保留切換鈕在側欄內，
// 不越過側欄右緣去蓋到主軸的角色選擇器 header）。
const COLLAPSED_RAIL_WIDTH = 44 // px，約 2.75rem，僅容納切換鈕
// 收合狀態抽到 module 單例 composable，與全域快捷鍵（Tab 切換）共用同一份。
const { collapsed, toggle: toggleSidebar } = useSidebarCollapse()
// 實際生效欄寬：展開＝prop 寬度；收合＝細軌道寬。
const effectiveSidebarWidth = computed(() =>
  collapsed.value ? COLLAPSED_RAIL_WIDTH : props.sidebarWidth
)
</script>

<template>
  <div
    class="app-layout"
    :class="{ 'app-layout--collapsed': collapsed }"
    :style="{
      '--app-sidebar-width': `${effectiveSidebarWidth}px`,
      '--app-sidebar-expanded-width': `${props.sidebarWidth}px`,
      '--app-header-height': `${props.headerHeight}px`,
      '--app-toggle-reserve': '2.75rem',
    }"
  >
    <!-- 標題列與側邊欄皆屬「禁止放置區」：不掛任何 drop/delete 屬性，
         游標在此 → _handleDragOver 判定為禁止放置（顯示禁止圖標、放開彈回） -->
    <div class="app-layout__header">
      <slot name="header" />
    </div>

    <div class="app-layout__sidebar">
      <div class="app-layout__sidebar-inner">
        <slot name="sidebar" />
      </div>
    </div>

    <div class="app-layout__main">
      <slot name="main" />
    </div>

    <!-- 側邊欄收合切換鈕：釘在側邊欄右上角（側欄／主軸交界頂部），
         隨欄寬一起過渡位移。展開時為「<」收起，收合時為「>」展開。 -->
    <button
      type="button"
      class="sidebar-toggle"
      :aria-label="collapsed ? '展開側邊欄' : '收合側邊欄'"
      :aria-expanded="!collapsed"
      @click="toggleSidebar"
    >
      <svg class="sidebar-toggle__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
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
  /* 收合／展開時欄寬平滑過渡（現代瀏覽器可內插 <length> 1fr） */
  transition: grid-template-columns 0.25s ease;
  position: relative;
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

/* 收合（細軌道）時：隱藏側欄內容與捲軸，只留下軌道與切換鈕 */
.app-layout--collapsed .app-layout__sidebar {
  overflow: hidden;
}
.app-layout--collapsed .app-layout__sidebar-inner {
  visibility: hidden;
}

.app-layout__sidebar-inner {
  height: 100%;
  /* 內容層固定為「展開後寬度」，與動畫中的容器寬度脫鉤：收合／展開時容器寬度
     過渡，內容靠容器 overflow-x:hidden 裁切揭露，內部 flex-wrap 不再隨中間寬度
     即時重排 → 消除「擠壓閃現」。 */
  width: var(--app-sidebar-expanded-width);
}

/* ── 側邊欄收合切換鈕 ─────────────────────────────────────────
   永遠釘在「側邊欄內部」的右上角：left=欄寬、translateX(-100%) 讓鈕右緣
   貼齊側欄右緣內側（再留 0.5rem 邊距），故隨欄寬過渡且絕不越過側欄右緣去
   蓋到主軸的角色選擇器 header。收合成細軌道後鈕仍留在軌道內可見。 */
.sidebar-toggle {
  position: absolute;
  /* 垂直對齊「預設／自訂」切換列中心（切換列在 sidebar 內距 top 0.5rem 起、
     高約 1.875rem，與本鈕同高 → 同一 top 即同一橫列、同層不互蓋）。 */
  top: calc(var(--app-header-height) + 0.5rem);
  left: var(--app-sidebar-width);
  transform: translateX(-100%);
  margin-left: -0.5rem;
  z-index: 50;

  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.875rem;
  height: 1.875rem;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background-color: #131b2e;
  color: rgba(255, 255, 255, 0.60);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);

  transition:
    left 0.25s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.sidebar-toggle:hover,
.sidebar-toggle:focus-visible {
  background-color: #1b2740;
  border-color: rgba(34, 211, 238, 0.55);
  color: rgba(34, 211, 238, 0.95);
}

/* 移除瀏覽器預設 focus ring（橘/白外框，非本專案實作）；
   改用與 hover 一致的青色回饋（focus-visible）保留鍵盤可視性。 */
.sidebar-toggle:focus {
  outline: none;
}

.sidebar-toggle__icon {
  width: 1.0625rem;
  height: 1.0625rem;
  /* 展開時「<」收起；收合時旋轉 180° 變「>」展開 */
  transition: transform 0.25s ease;
}

.app-layout--collapsed .sidebar-toggle__icon {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .app-layout,
  .sidebar-toggle,
  .sidebar-toggle__icon {
    transition: none;
  }
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

<script setup lang="ts">
// ============================================================
// DragCountBadge.vue — 多選拖曳數量徽章(共用純視覺元件)。
// 主軸 RotationBlock 與側邊欄 GeneralBlockField / CustomBlockField 共用。
//
// 機制:平時 display:none,SortableJS forceFallback 拖曳時把被抓 DOM
// cloneNode 成浮動分身並掛上 .sortable-fallback,style.css 的全域規則
// 「.sortable-fallback .rotation-block__drag-count { display:flex }」
// 才把徽章翻成顯示 → 只有分身看得到數字,原位區塊不受影響。
//
// 注意:
//   - 類名 rotation-block__drag-count 是全域規則的鉤子,不可改名。
//   - scoped 樣式仍作用於分身:cloneNode 會連 data-v-* 屬性一起複製。
//   - 定位基準為外層的 position:relative 容器(.rotation-block / .chip-wrapper)。
//   - 顯示條件(是否被選取、選取數 >1)由呼叫端以 v-if 控制。
// ============================================================

defineProps<{
  /** 顯示的數量(呼叫端保證 >1 才渲染) */
  count: number
}>()
</script>

<template>
  <span class="rotation-block__drag-count" aria-hidden="true">
    {{ count }}
  </span>
</template>

<style scoped>
/* 右上角圓點,部分溢出 chip;平時隱藏,只在浮動分身上顯示(見檔頭說明)。 */
.rotation-block__drag-count {
  display: none;
  position: absolute;
  top: -7px;
  right: -7px;
  z-index: 20; /* 高於 chip(label z-index 2、選中光暈等)與側欄刪除鈕(z-index 10) */
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background-color: #22d3ee;
  color: #06121a;
  font-family: var(--app-font-mono, 'JetBrains Mono', 'Fira Code', 'Consolas', ui-monospace), sans-serif;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
  border: 1.5px solid rgba(6, 18, 26, 0.85);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
</style>

<script setup lang="ts">
// ============================================================
// App.vue
// 根元件：負責掛載全域 UI 結構。
//
// 目前為 Phase 1 骨架版本。
// Phase 3 實作 AppLayout / ToastNotification 後，
// 請將此檔案替換為 Phase 3 提供的完整版本。
// ============================================================
</script>

<template>
  <!--
    根容器：撐滿視窗、禁止外層捲動。
    所有捲動行為由內部各子元件自行控制（泳道水平捲動、側邊欄垂直捲動）。
  -->
  <div
    id="app-root"
    class="h-screen w-screen overflow-hidden bg-void text-white font-sans"
  >
    <!--
      Phase 1 臨時佔位畫面。
      Phase 3 完成後，以下內容會替換為：
        <AppLayout />
        <ToastNotification />
    -->
    <div class="flex h-full items-center justify-center flex-col gap-4">
      <p class="text-chrome font-mono text-2xl tracking-widest">WUWA ROTATION TOOL</p>
      <p class="text-white/30 text-sm">Phase 1 骨架 — 建置環境就緒</p>
      <div class="flex gap-3 mt-2">
        <span class="px-3 py-1 rounded bg-surface text-white/60 text-xs font-mono">Vue 3</span>
        <span class="px-3 py-1 rounded bg-surface text-white/60 text-xs font-mono">TypeScript</span>
        <span class="px-3 py-1 rounded bg-surface text-white/60 text-xs font-mono">Pinia</span>
        <span class="px-3 py-1 rounded bg-surface text-white/60 text-xs font-mono">Tailwind CSS</span>
        <span class="px-3 py-1 rounded bg-surface text-white/60 text-xs font-mono">VueDraggablePlus</span>
      </div>
    </div>
  </div>
</template>
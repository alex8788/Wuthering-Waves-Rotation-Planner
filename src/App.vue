<script setup lang="ts">
// App.vue — 整體組裝入口
// 待辦：角色選擇 UI（CharacterSelector）尚未串接，待決定放置位置後接上 useCharacterStore
import AppLayout from '@/components/layout/AppLayout.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import ToastNotification from '@/components/ui/ToastNotification.vue'
import DialogHost from '@/components/ui/DialogHost.vue'
import SidebarPanel from '@/components/sidebar/SidebarPanel.vue'
import RotationBoard from '@/components/rotation/RotationBoard.vue'
import RotationAxisTabBar from '@/components/rotation/RotationAxisTabBar.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useRotationStore } from '@/stores/useRotationStore'
import { useSidebarStore } from '@/stores/useSidebarStore'

const rotationStore = useRotationStore()
const sidebarStore = useSidebarStore()

useKeyboardShortcuts()

// 點擊任何空白區域 → 一併清除主軸與模板庫的選取（共用同一入口）。
// 區塊/模板 chip 各自 @click.stop，不會冒泡到此；框選結束時 RotationBoard
// 的 window capture 攔截器會擋下這次 click，故不會誤清剛框選的內容。
function clearAllSelection(): void {
  rotationStore.clearSelection()
  sidebarStore.clearTemplateSelection()
}
</script>

<template>
  <div class="app-root" @click="clearAllSelection()">
    <AppLayout :sidebar-width="300" :header-height="64">
      <template #header>
        <AppHeader />
      </template>

      <template #sidebar>
        <SidebarPanel />
      </template>

      <template #main>
        <RotationBoard />
      </template>

      <template #tabbar>
        <RotationAxisTabBar />
      </template>
    </AppLayout>

    <ToastNotification />
    <DialogHost />
  </div>
</template>

<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0A0F1E; }

  .app-root {
  width: 100%;
  height: 100%;
  }
</style>
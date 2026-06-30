<script setup lang="ts">
// App.vue — 整體組裝入口
// 待辦：角色選擇 UI（CharacterSelector）尚未串接，待決定放置位置後接上 useCharacterStore
import AppLayout from '@/components/layout/AppLayout.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import ToastNotification from '@/components/ui/ToastNotification.vue'
import DialogHost from '@/components/ui/DialogHost.vue'
import ExportDialog from '@/components/ui/ExportDialog.vue'
import SidebarPanel from '@/components/sidebar/SidebarPanel.vue'
import RotationBoard from '@/components/rotation/RotationBoard.vue'
import RotationAxisTabBar from '@/components/rotation/RotationAxisTabBar.vue'
import RotationExportView from '@/components/rotation/RotationExportView.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useExportDialog } from '@/composables/useExportDialog'
import { useRotationStore } from '@/stores/useRotationStore'
import { useSidebarStore } from '@/stores/useSidebarStore'

const rotationStore = useRotationStore()
const sidebarStore = useSidebarStore()
const exportDialog = useExportDialog()

useKeyboardShortcuts()

// 匯出流程入口：開設定視窗取得選項。實際出圖 / 存檔於後續階段接上。
async function handleExport(): Promise<void> {
  const options = await exportDialog.open()
  if (!options) return
  // 階段一：先確認選項正確,實際點陣化與存檔於階段三、四接上。
  console.log('[export] options', options)
}

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
        <AppHeader>
          <template #actions>
            <button
              type="button"
              class="export-trigger"
              title="匯出輸出軸圖片"
              @click.stop="handleExport"
            >匯出</button>
          </template>
        </AppHeader>
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
    <ExportDialog />

    <!-- 階段二暫時:可視驗證匯出視圖版面,階段三改為離螢幕並由匯出流程驅動 -->
    <div class="export-stage-preview">
      <RotationExportView :axis="rotationStore.activeAxis" />
    </div>
  </div>
</template>

<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0A0F1E; }

  .app-root {
  width: 100%;
  height: 100%;
  }

  /* 標題列匯出按鈕：沿用 header 暗色 + 青色強調風格 */
  .export-trigger {
    padding: 0.35rem 0.85rem;
    border: 1px solid rgba(34, 211, 238, 0.45);
    border-radius: 4px;
    background-color: rgba(34, 211, 238, 0.06);
    color: rgba(34, 211, 238, 0.95);
    font-size: 0.8125rem;
    font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }
  .export-trigger:hover {
    background-color: rgba(34, 211, 238, 0.16);
    border-color: rgba(34, 211, 238, 0.7);
  }
  .export-trigger:focus-visible {
    outline: 1px solid rgba(34, 211, 238, 0.6);
    outline-offset: 1px;
  }

  /* 階段二暫時:把匯出視圖浮在右下角供視覺驗證(階段三移除) */
  .export-stage-preview {
    position: fixed;
    right: 12px;
    bottom: 48px;
    z-index: 9999;
    max-width: 70vw;
    max-height: 70vh;
    overflow: auto;
    border: 1px solid rgba(34, 211, 238, 0.4);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  }
</style>
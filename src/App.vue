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
import { nodeToPngBlob, savePng } from '@/composables/useImageExport'
import { showToast } from '@/composables/useToast'
import { useRotationStore } from '@/stores/useRotationStore'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { nextTick, ref } from 'vue'
import type { RotationAxis } from '@/types/rotation'

const rotationStore = useRotationStore()
const sidebarStore = useSidebarStore()
const exportDialog = useExportDialog()

useKeyboardShortcuts()

// 離螢幕匯出舞台:把要輸出的軸暫時掛上,點陣化後清空。
const exportStageRef = ref<HTMLElement | null>(null)
const renderAxis = ref<RotationAxis | null>(null)

// 把指定軸渲染到離螢幕舞台,等繪製與字型就緒後截成 PNG Blob。
async function renderAxisToBlob(axis: RotationAxis): Promise<Blob> {
  renderAxis.value = axis
  try {
    await nextTick()
    const node = exportStageRef.value?.querySelector<HTMLElement>('.export-view')
    if (!node) throw new Error('找不到匯出視圖節點')
    return await nodeToPngBlob(node)
  } finally {
    renderAxis.value = null
  }
}

// 匯出流程入口：開設定視窗 → 取得選項 → 點陣化 → 存檔。
// 階段三:單軸。多軸合併 / 分開(ZIP)於階段四接上。
async function handleExport(): Promise<void> {
  const options = await exportDialog.open()
  if (!options) return

  const axis = rotationStore.axes.find((a) => a.id === options.axisIds[0])
  if (!axis) return

  try {
    const blob = await renderAxisToBlob(axis)
    const saved = await savePng(blob, options.filename)
    if (saved) showToast('已匯出圖片', 'success')
  } catch (err) {
    console.error('[export] 匯出失敗', err)
    const msg = err instanceof Error ? err.message : String(err)
    showToast(`匯出失敗:${msg}`, 'danger', 6000)
  }
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

    <!-- 離螢幕匯出舞台:平時不渲染任何軸,匯出時才暫時掛上要輸出的軸供截圖 -->
    <div ref="exportStageRef" class="export-stage" aria-hidden="true">
      <RotationExportView v-if="renderAxis" :axis="renderAxis" />
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

  /* 離螢幕匯出舞台:移出可視範圍(不可用 display:none,否則量不到尺寸/截不到圖) */
  .export-stage {
    position: fixed;
    left: -99999px;
    top: 0;
    pointer-events: none;
  }
</style>
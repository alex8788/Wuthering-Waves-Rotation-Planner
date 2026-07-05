<script setup lang="ts">
// App.vue — 整體組裝入口：版面殼層 + 各面板 + 全域快捷鍵 + 離螢幕匯出舞台。
import AppLayout from '@/components/layout/AppLayout.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import ToastNotification from '@/components/ui/ToastNotification.vue'
import DialogHost from '@/components/ui/DialogHost.vue'
import ExportDialog from '@/components/ui/ExportDialog.vue'
import SettingsMenu from '@/components/ui/SettingsMenu.vue'
import SidebarPanel from '@/components/sidebar/SidebarPanel.vue'
import RotationBoard from '@/components/rotation/RotationBoard.vue'
import RotationAxisTabBar from '@/components/rotation/RotationAxisTabBar.vue'
import RotationExportView from '@/components/rotation/RotationExportView.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useExportDialog } from '@/composables/state/useExportDialog'
import { nodeToPngBlob, nodeToSvgBlob, savePng, saveSvg, saveZip } from '@/composables/useImageExport'
import type { ExportFormat } from '@/composables/state/useExportDialog'
import { showToast } from '@/composables/state/useToast'
import { useRotationStore } from '@/stores/useRotationStore'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { useDefaultBlockStore } from '@/stores/useDefaultBlockStore'
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import JSZip from 'jszip'
import type { RotationAxis } from '@/types/rotation'

const rotationStore = useRotationStore()
const sidebarStore = useSidebarStore()
const defaultBlockStore = useDefaultBlockStore()
const exportDialog = useExportDialog()
const { t } = useI18n()

useKeyboardShortcuts()

// 離螢幕匯出舞台:把要輸出的軸暫時掛上(可同時多軸供合併),點陣化後清空。
const exportStageRef = ref<HTMLElement | null>(null)
const renderAxes = ref<RotationAxis[]>([])

// 把一組軸渲染到離螢幕舞台,等繪製與字型就緒後,截取指定節點成圖片 Blob。
//  - 合併:傳入多軸,截取整個 .export-merge-wrap(多軸縱向堆疊)。
//  - 單張:傳入單軸,截取該軸的 .export-view。
// format='svg' 轉向量圖(檔案小);'png' 依 scale 倍率點陣化。
async function renderToBlob(
  axes: RotationAxis[],
  selector: string,
  format: ExportFormat,
  scale: number,
): Promise<Blob> {
  renderAxes.value = axes
  await nextTick()
  const node = exportStageRef.value?.querySelector<HTMLElement>(selector)
  if (!node) throw new Error(t('export.nodeNotFound'))
  return format === 'svg' ? await nodeToSvgBlob(node) : await nodeToPngBlob(node, scale)
}

// 檔名淨化:移除檔案系統 / ZIP 條目不允許的字元。
function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'axis'
}

// 匯出流程入口：開設定視窗 → 取得選項 → 點陣化 →(合併 / 分開 ZIP)→ 存檔。
async function handleExport(): Promise<void> {
  const options = await exportDialog.open()
  if (!options) return

  const axes = options.axisIds
    .map((id) => rotationStore.axes.find((a) => a.id === id))
    .filter((a): a is RotationAxis => a != null)
  if (axes.length === 0) return

  const { format, scale } = options
  const ext = format === 'svg' ? 'svg' : 'png'

  try {
    if (axes.length === 1 || options.mode === 'merge') {
      // 單軸或合併:一張圖。多軸截整個堆疊容器,單軸截該視圖。
      const selector = axes.length > 1 ? '.export-merge-wrap' : '.export-view'
      const blob = await renderToBlob(axes, selector, format, scale)
      renderAxes.value = []
      const saved = format === 'svg'
        ? await saveSvg(blob, options.filename)
        : await savePng(blob, options.filename)
      if (saved) showToast(t(format === 'svg' ? 'toast.exportedSvg' : 'toast.exportedPng'), 'success')
    } else {
      // 多軸分開:逐軸出圖 → 打包成單一 ZIP。
      const zip = new JSZip()
      const usedNames = new Set<string>()
      for (const axis of axes) {
        const blob = await renderToBlob([axis], '.export-view', format, scale)
        let entry = sanitizeName(axis.name)
        let n = 2
        while (usedNames.has(entry)) entry = `${sanitizeName(axis.name)} (${n++})`
        usedNames.add(entry)
        zip.file(`${entry}.${ext}`, blob)
      }
      renderAxes.value = []
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const saved = await saveZip(zipBlob, options.filename)
      if (saved) showToast(t('toast.exportedZip'), 'success')
    }
  } catch (err) {
    console.error('[export] 匯出失敗', err)
    const msg = err instanceof Error ? err.message : String(err)
    showToast(t('toast.exportFailed', { msg }), 'danger', 6000)
  } finally {
    renderAxes.value = []
  }
}

// 點擊任何空白區域 → 一併清除主軸、模板庫、通用預設區塊的選取（共用同一入口）。
// 區塊/模板 chip 各自 @click.stop，不會冒泡到此；框選結束時 RotationBoard
// 的 window capture 攔截器會擋下這次 click，故不會誤清剛框選的內容。
function clearAllSelection(): void {
  rotationStore.clearSelection()
  sidebarStore.clearTemplateSelection()
  defaultBlockStore.clearSelection()
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
              :title="$t('header.exportTooltip')"
              @click.stop="handleExport"
            >{{ $t('header.export') }}</button>
            <SettingsMenu />
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

    <!-- 離螢幕匯出舞台:平時不渲染任何軸,匯出時才暫時掛上要輸出的軸供截圖。
         合併多軸時,export-merge-wrap 內縱向堆疊多個視圖,整塊截一張。 -->
    <div ref="exportStageRef" class="export-stage" aria-hidden="true">
      <div v-if="renderAxes.length" class="export-merge-wrap">
        <RotationExportView v-for="ax in renderAxes" :key="ax.id" :axis="ax" />
      </div>
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

  /* 合併多軸:縱向堆疊各軸視圖,容器寬度貼齊最寬的一軸;深色底填滿軸間縫隙 */
  .export-merge-wrap {
    display: inline-flex;
    flex-direction: column;
    background-color: #0A0F1E;
  }
</style>
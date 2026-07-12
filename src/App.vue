<script setup lang="ts">
// App.vue — 整體組裝入口：版面殼層 + 各面板 + 全域快捷鍵 + 離螢幕匯出舞台。
import AppLayout from '@/components/layout/AppLayout.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
import ToastNotification from '@/components/ui/ToastNotification.vue'
import DialogHost from '@/components/ui/DialogHost.vue'
import ExportDialog from '@/components/ui/ExportDialog.vue'
import TeamManagerDialog from '@/components/ui/TeamManagerDialog.vue'
import HelpDialog from '@/components/ui/HelpDialog.vue'
import SettingsMenu from '@/components/ui/SettingsMenu.vue'
import SidebarPanel from '@/components/sidebar/SidebarPanel.vue'
import RotationBoard from '@/components/rotation/RotationBoard.vue'
import RotationAxisTabBar from '@/components/rotation/RotationAxisTabBar.vue'
import RotationExportView from '@/components/rotation/RotationExportView.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useExportDialog } from '@/composables/state/useExportDialog'
import { useTeamManager } from '@/composables/state/useTeamManager'
import { useHelpDialog } from '@/composables/state/useHelpDialog'
import { useSpotlightTour } from '@/composables/state/useSpotlightTour'
import { nodeToPngBlob, nodeToSvgBlob, savePng, saveSvg, saveZip } from '@/composables/useImageExport'
import type { ExportFormat } from '@/composables/state/useExportDialog'
import { showToast } from '@/composables/state/useToast'
import { useRotationStore } from '@/stores/useRotationStore'
import { useTemplateStore } from '@/stores/useTemplateStore'
import { useGeneralBlockStore } from '@/stores/useGeneralBlockStore'
import { useSavedTeamStore } from '@/stores/useSavedTeamStore'
import { nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import JSZip from 'jszip'
import type { RotationAxis } from '@/types/rotation'

const rotationStore = useRotationStore()
const templateStore = useTemplateStore()
const generalBlockStore = useGeneralBlockStore()
const savedTeamStore = useSavedTeamStore()
const exportDialog = useExportDialog()
const teamManager = useTeamManager()
const helpDialog = useHelpDialog()
const tour = useSpotlightTour()
const { t } = useI18n()

// 排軸內容非持久化，但當前隊伍綁定會保留；重整後把綁定存檔的內容補回工作區，
// 避免空工作區被誤判為「有未存變更」（進而誤覆蓋成空）。
savedTeamStore.hydrateCurrentTeam()

// 首訪自動播放功能導覽（僅第一次；之後由使用說明視窗的「重新觀看」重播）。
onMounted(() => {
  if (!tour.hasSeenTour.value) tour.start()
})

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
  templateStore.clearTemplateSelection()
  generalBlockStore.clearSelection()
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
              data-tour="teams"
              :title="$t('teams.openTooltip')"
              @click.stop="teamManager.open()"
            >{{ $t('teams.open') }}</button>
            <button
              type="button"
              class="export-trigger"
              data-tour="export"
              :title="$t('header.exportTooltip')"
              @click.stop="handleExport"
            >{{ $t('header.export') }}</button>
            <SettingsMenu />
            <button
              type="button"
              class="help-trigger"
              data-tour="help"
              :title="$t('help.openTooltip')"
              :aria-label="$t('help.openTooltip')"
              @click.stop="helpDialog.open()"
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4" />
                <path
                  d="M7.6 7.4a2.4 2.4 0 0 1 4.7.7c0 1.6-2.3 2-2.3 3.4"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
                <circle cx="10" cy="14.6" r="0.9" fill="currentColor" />
              </svg>
            </button>
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
    <TeamManagerDialog />
    <HelpDialog />

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

  /* 標題列說明按鈕：與齒輪同款中性方形圖示鈕（沿用 SettingsMenu 觸發鈕語彙） */
  .help-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 4px;
    background-color: rgba(255, 255, 255, 0.04);
    color: rgba(240, 244, 248, 0.65);
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .help-trigger:hover {
    background-color: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.35);
    color: rgba(240, 244, 248, 0.95);
  }
  .help-trigger:focus-visible {
    outline: none;
    border-color: rgba(34, 211, 238, 0.6);
    color: rgba(34, 211, 238, 0.95);
  }
  .help-trigger svg {
    width: 1.125rem;
    height: 1.125rem;
  }

  /* ── 功能導覽（driver.js）暗色主題：套 popoverClass='tour-popover' ── */
  .driver-popover.tour-popover {
    background-color: #243456;
    border: 1px solid rgba(34, 211, 238, 0.75);
    border-radius: 8px;
    box-shadow:
      0 0 0 1px rgba(34, 211, 238, 0.3),
      0 0 24px -4px rgba(34, 211, 238, 0.4),
      0 24px 70px -12px rgba(0, 0, 0, 0.9);
    color: rgba(240, 244, 248, 0.92);
    font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
    max-width: 20rem;
  }
  /* spotlight 發光邊框：獨立 fixed 元素（見 useSpotlightTour startStageRing），
     以 rAF 跟隨高亮元素。用獨立元素而非高亮元素的 box-shadow，可避開
     .rotation-board/.board__scroll 等 overflow:hidden 祖先的裁切，並疊在暗遮罩(10000)之上。 */
  .tour-stage-ring {
    position: fixed;
    z-index: 10001;
    pointer-events: none;
    border: 2px solid rgba(34, 211, 238, 0.833);
    border-radius: 6px;
    box-shadow:
      0 0 22px 3px rgba(34, 211, 238, 0.55),
      0 0 0 1px rgba(34, 211, 238, 0.5);
    opacity: 0;
  }
  .driver-popover.tour-popover .driver-popover-title {
    font-size: 0.9375rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: rgba(240, 244, 248, 0.98);
  }
  .driver-popover.tour-popover .driver-popover-description {
    font-size: 0.8125rem;
    line-height: 1.5;
    color: rgba(240, 244, 248, 0.72);
  }
  .driver-popover.tour-popover .driver-popover-progress-text {
    font-size: 0.6875rem;
    letter-spacing: 0.08em;
    color: rgba(34, 211, 238, 0.7);
  }
  /* 箭頭：填色同氣泡底（融為氣泡一部分），再加青色光暈讓「發光邊框」在箭頭處也連成一圈，
     避免箭頭與相近的頁面底色混在一起看不見。 */
  .driver-popover.tour-popover .driver-popover-arrow {
    filter: drop-shadow(0 0 6px rgba(34, 211, 238, 0.95));
  }
  .driver-popover.tour-popover .driver-popover-arrow-side-left.driver-popover-arrow { border-left-color: #243456; }
  .driver-popover.tour-popover .driver-popover-arrow-side-right.driver-popover-arrow { border-right-color: #243456; }
  .driver-popover.tour-popover .driver-popover-arrow-side-top.driver-popover-arrow { border-top-color: #243456; }
  .driver-popover.tour-popover .driver-popover-arrow-side-bottom.driver-popover-arrow { border-bottom-color: #243456; }

  .driver-popover.tour-popover .driver-popover-footer button {
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 4px;
    color: rgba(240, 244, 248, 0.85);
    text-shadow: none;
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.3rem 0.7rem;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .driver-popover.tour-popover .driver-popover-footer button:hover {
    background-color: rgba(34, 211, 238, 0.16);
    border-color: rgba(34, 211, 238, 0.55);
    color: rgba(34, 211, 238, 0.95);
  }
  .driver-popover.tour-popover .driver-popover-close-btn {
    color: rgba(240, 244, 248, 0.5);
  }
  .driver-popover.tour-popover .driver-popover-close-btn:hover {
    color: rgba(240, 244, 248, 0.95);
  }

  /* ── 導覽示範動畫：虛擬滑鼠指標 / 點擊漣漪 / 框選框 ── */
  /* 導覽期間：把被 Teleport 的真實 UI 抬到 driver 遮罩（z-index 1e9）之上，
     否則下拉選單／確認框會被遮罩蓋住變暗、看不清。 */
  body.tour-active .char-selector__listbox {
    z-index: 1000000010 !important;
  }
  body.tour-active .dialog-overlay {
    z-index: 1000000014 !important;
  }
  /* 真實拖曳期間：driver 的 disableActiveInteraction 會把高亮元件設為
     pointer-events:none!important，導致 App 的 elementFromPoint 取不到泳道、
     判為「禁止放置」。拖曳時暫時強制排軸板可命中（遮罩/氣泡則於 JS 關閉）。 */
  body.tour-dragging .rotation-board,
  body.tour-dragging .rotation-board *,
  body.tour-dragging .sidebar-panel,
  body.tour-dragging .sidebar-panel * {
    pointer-events: auto !important;
  }

  .tour-cursor {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000000030;
    pointer-events: none;
    opacity: 0;
    transform: translate(-100px, -100px);
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6));
    transition: opacity 0.2s ease;
    will-change: transform;
  }
  .tour-cursor svg {
    display: block;
    transition: transform 0.12s ease;
  }
  .tour-cursor--press svg,
  .tour-cursor--drag svg {
    transform: scale(0.82);
  }
  .tour-ripple {
    position: fixed;
    z-index: 1000000028;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    pointer-events: none;
    background: rgba(34, 211, 238, 0.5);
    box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.8);
    animation: tour-ripple 0.6s ease-out forwards;
  }
  @keyframes tour-ripple {
    0% { transform: scale(0.3); opacity: 0.9; }
    100% { transform: scale(3.2); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tour-ripple { animation: none; }
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
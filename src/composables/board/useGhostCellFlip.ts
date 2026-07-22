// ============================================================
// useGhostCellFlip.ts — 熱鍵輸入模式幽靈格的 FLIP 平滑移動。
//
// 幽靈格位置由 grid-column／所在泳道決定，且切泳道時 v-if 銷毀重建
// （新舊為不同 DOM 節點），CSS transition 無從接續 → 用 FLIP：
//   位置改變「前」（pre-flush watcher，DOM 尚未更新）記下舊螢幕座標，
//   DOM 更新後（nextTick）量新座標，以 transform 從舊位置補間滑到新位置。
// 舊座標存於 composable 變數、不依賴舊節點，故跨泳道重建也能接。
//
// 設計決策：
//   - grid 佈局仍是唯一位置真相，不自行同步座標（避免捲動／縮放跟丟 bug）。
//   - 只補間 transform（位置），不補間寬度——合併預顯的寬度變化若做縮放
//     補間會拉扁文字；寬度向右長、左緣不動，本就無需動畫。
//   - 用 Web Animations API（el.animate）：動畫自帶生命週期，不留 inline
//     style、也不與其他 class 樣式衝突。
//   - 觸發源：選中泳道（垂直移動）／entries 數（落子・刪除的欄位變化）／
//     合併預顯文字（結算落子時欄序跳變）。僅模式啟用中作用。
//
// 由 RotationBoard setup 呼叫一次；watcher 隨元件卸載自動清理。
// ============================================================

import { nextTick, watch } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useHotkeyInputMode } from '@/composables/state/useHotkeyInputMode';
import { prefersReducedMotion } from '@/utils/reducedMotion';

const GHOST_SELECTOR = '.track__ghost-cell';
// 補間時長：略短於落子進場動畫（260ms），讓「格子滑到新落點」先收尾、
// 不與新區塊的進場搶焦點。調整手感改這裡。
const FLIP_MS = 180;

export function useGhostCellFlip(): void {
  const rotationStore = useRotationStore();
  const hotkeyMode = useHotkeyInputMode();

  // 位置改變前的幽靈格螢幕座標（viewport 座標系）；null＝改變前不存在（如剛進入模式）。
  let _lastRect: DOMRect | null = null;

  watch(
    () => [
      rotationStore.selectedLaneIndex,
      rotationStore.entries.length,
      hotkeyMode.tapCombineLabel.value,
    ],
    () => {
      if (!hotkeyMode.active.value) {
        _lastRect = null;
        return;
      }
      // pre-flush：DOM 尚未更新，此刻量到的是「舊位置」。
      _lastRect = document.querySelector(GHOST_SELECTOR)?.getBoundingClientRect() ?? null;
      void nextTick(() => {
        const from = _lastRect;
        _lastRect = null;
        if (!from || prefersReducedMotion()) return;
        const el = document.querySelector<HTMLElement>(GHOST_SELECTOR);
        if (!el) return; // 已退出模式／幽靈格不存在 → 不動畫
        const to = el.getBoundingClientRect();
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // 位置沒變（如僅寬度變化）
        // FLIP：先瞬間推回舊位置，再過渡回原位（transform 不觸發 layout，效能佳）。
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: FLIP_MS, easing: 'ease-out' },
        );
      });
    },
    { flush: 'pre' },
  );
}

// ============================================================
// useGhostConveyor.ts — 熱鍵輸入模式幽靈格的「輸送帶」動態（R2，取代舊 FLIP）。
//
// 節奏遊戲式概念反轉：幽靈格釘在可視軌道區水平中央不動，底下的軸像
// 輸送帶捲動。做法：
//   位置改變「前」（pre-flush watcher）記下幽靈格舊螢幕座標；DOM 更新後
//   （nextTick）算出「讓幽靈格置中」的目標 scrollLeft，用自製 rAF 補間
//   捲過去，同時每幀給幽靈格反向 translateX（＝當前捲距−目標捲距），
//   兩者同幀更新完全抵銷 → 幽靈格全程釘在最終置中位置，區塊往左滑走。
//
// 為何不用原生 scrollTo({behavior:'smooth'})＋另行釘格：原生平滑捲動的
// 每幀進度拿不到，反向補償只能靠 scroll 事件追，慢一幀就微顫；自製 rAF
// 同幀設 scrollLeft 與 transform 才能零誤差。
//
// 設計決策：
//   - 垂直方向（切泳道的跨泳道重建）併入同一 rAF 補間（dy 隨 easing 收斂
//     至 0），不另開 WAAPI 動畫——兩套動畫疊同一 transform 會互蓋。
//   - 幽靈格不是 .rotation-block，inline transform 與 SortableJS 無衝突。
//   - 首幀即同步就位：nextTick 在繪製前執行，幽靈格從第一幀就顯示在最終
//     置中位置，不會先閃現在未補償的位置。
//   - 左端極限（區塊太少、scrollLeft clamp 到 0）：幽靈格自然靠左，屬預期
//     行為;右端由既有的尾端墊片（半螢幕寬）保證恆有置中空間。
//   - 觸發源：選中泳道（垂直）／entries 數（落子・刪除）。僅模式啟用中作用。
//
// 由 RotationBoard setup 呼叫一次；watcher 隨元件卸載自動清理。
// ============================================================

import { nextTick, watch } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useHotkeyInputMode } from '@/composables/state/useHotkeyInputMode';
import { computeCenterScrollLeft } from '@/composables/board/useBoardScroll';
import { prefersReducedMotion } from '@/utils/reducedMotion';

const GHOST_SELECTOR = '.track__ghost-cell';
const SCROLL_SELECTOR = '.board__scroll';
// 輸送帶補間時長：略短於落子進場動畫（260ms），讓軸面先穩定、新區塊進場收尾。
const CONVEYOR_MS = 220;

export function useGhostConveyor(): void {
  const rotationStore = useRotationStore();
  const hotkeyMode = useHotkeyInputMode();

  // 位置改變前的幽靈格螢幕座標；null＝改變前不存在（如剛進入模式，不動畫）。
  let _lastRect: DOMRect | null = null;
  // 進行中的補間 rAF id（新觸發即取消重算，快速連打時從當前狀態接續）。
  let _rafId: number | null = null;

  watch(
    // 觸發源：選中泳道（垂直）／entries 數（落子・刪除）。合併預顯文字不再是
    // 觸發源——R3 後預顯外置、幽靈格固定正方，文字長度不影響置中。
    () => [rotationStore.selectedLaneIndex, rotationStore.entries.length],
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
        const ghost = document.querySelector<HTMLElement>(GHOST_SELECTOR);
        const scroll = document.querySelector<HTMLElement>(SCROLL_SELECTOR);
        if (!ghost || !scroll) return; // 已退出模式 → 不動畫
        // 以「整個視窗」為置中基準：容器在側欄右側，軌道區中心相對螢幕偏右，
        // 視窗基準才符合「幽靈格釘在螢幕正中央」（與 enter() 的初次置中一致）。
        const target = computeCenterScrollLeft(ghost, scroll, 'viewport');
        // 垂直分量：跨泳道重建時從舊泳道位置滑過來；改變前不存在則無垂直動畫。
        const dy0 = from ? from.top - ghost.getBoundingClientRect().top : 0;
        _animate(scroll, ghost, target, dy0);
      });
    },
    { flush: 'pre' },
  );

  /** rAF 補間：scrollLeft s0→target，幽靈格同幀反向補償（水平釘住＋垂直滑入）。 */
  function _animate(scroll: HTMLElement, ghost: HTMLElement, target: number, dy0: number): void {
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    const s0 = scroll.scrollLeft;
    const delta = target - s0;
    if (prefersReducedMotion() || (Math.abs(delta) < 1 && Math.abs(dy0) < 1)) {
      scroll.scrollLeft = target;
      ghost.style.transform = '';
      return;
    }
    const t0 = performance.now();
    const easeOut = (p: number): number => 1 - (1 - p) ** 3;
    const step = (now: number): void => {
      const p = Math.min((now - t0) / CONVEYOR_MS, 1);
      const eased = easeOut(p);
      const s = s0 + delta * eased;
      scroll.scrollLeft = s;
      if (p < 1) {
        // 水平：s−target＝尚未捲完的距離，反向平移抵銷 → 幽靈格螢幕位置不變。
        // 垂直：dy0 隨 easing 收斂至 0 → 從舊泳道位置滑到新泳道。
        ghost.style.transform = `translate(${s - target}px, ${dy0 * (1 - eased)}px)`;
        _rafId = requestAnimationFrame(step);
      } else {
        ghost.style.transform = '';
        _rafId = null;
      }
    };
    step(t0); // 首幀同步就位（nextTick 於繪製前執行，不閃爍）
  }
}

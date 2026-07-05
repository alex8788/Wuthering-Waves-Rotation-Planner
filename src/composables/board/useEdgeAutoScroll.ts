// ============================================================
// useEdgeAutoScroll.ts — 拖曳邊緣自動捲動（重構 R5）。
//
// 拖曳中游標超出捲動容器左/右邊緣時，RAF 迴圈持續改 scrollLeft，
// 每次實際捲動後呼叫 onScrolled()（讓拖曳落點重新評估）。
// 兩側觸發位置不對稱 → 速度模型不同（體感皆「慢→快」）：
//   ‧ 右側＝視窗右緣（物理牆）：時間式二次方加速（停留越久越快）。
//   ‧ 左側＝泳道 header 右緣（開放空間）：距離式緩衝（越往畫面左緣越快）。
// 呼叫端負責 start()/stop()（通常綁 isDragging watch）；卸載自動 stop。
// ============================================================

import { onBeforeUnmount, type Ref } from 'vue';

const EDGE_TOL = 4        // 容器左緣 fallback 的容差（px）
const RIGHT_EDGE_PX = 44  // 右側觸發帶寬度：游標進入容器右緣內側此範圍即向右捲。
                          // 原本僅 4px 幾乎踩不到，導致拖到泳道尾端不會自動捲、落點空欄
                          // 露不全(issue3)；擴大成正常邊緣捲動帶（中段拖曳仍不會誤觸）。
const LEFT_RAMP_PX = 140  // 左側：游標越過 header 右緣多遠時加速到頂（px）＝緩衝帶寬度
const MIN_STEP = 4        // 剛進入觸發區的起始速度（px/幀）
const MAX_STEP = 20       // 左側加速到頂的速度（px/幀）
const ACCEL_MS = 1000     // 右側：從 MIN_STEP 漸進加速到 RIGHT_MAX_STEP 所需的停留時間(ms)
// 右側專用：放慢頂速並拉長加速曲線（右緣是物理牆，體感過快 → 獨立調參）。
const RIGHT_MAX_STEP = 11 // 右側加速到頂的速度（px/幀，較左側 20 慢）
const RIGHT_ACCEL_MS = 1800 // 右側從 MIN_STEP 加速到頂所需停留時間(ms，較 1000 更緩）

export function useEdgeAutoScroll(
  scrollElRef: Ref<HTMLElement | null>,
  onScrolled: () => void,
) {
  let _rafId = 0;
  let _edgeClientX = Number.NaN; // 尚未收到 mousemove 前為 NaN → 下方比較皆 false → 不捲動
  let _accelStart = 0;           // 右側時間式加速的起始時間戳（0 = 目前不在右側觸發區）

  function onDragMouseMove(event: MouseEvent): void {
    _edgeClientX = event.clientX;
  }

  function autoScrollTick(): void {
    const el = scrollElRef.value;
    if (el) {
      const rect = el.getBoundingClientRect();
      // 左界用泳道 sticky header 的右緣：header 蓋在軌道左側（sticky left:0、z-index:5），
      // 視覺上的軌道左邊界＝header 右緣，而非容器左緣。游標移到 header 右緣以左即往左捲。
      const header = el.querySelector('.swimlane__header');
      const leftBound = header ? header.getBoundingClientRect().right : rect.left + EDGE_TOL;

      let dir = 0;
      let step = 0;
      // NaN（未移動）時兩式皆 false → dir 維持 0。
      if (_edgeClientX <= leftBound) {
        // 左側：距離式緩衝。距 header 右緣越遠（越往畫面左緣）越快，二次方緩動。
        dir = -1;
        _accelStart = 0; // 左側不用時間式，清掉右側殘留的計時，避免切換側時殘留加速
        const f = Math.min(1, (leftBound - _edgeClientX) / LEFT_RAMP_PX);
        step = MIN_STEP + (MAX_STEP - MIN_STEP) * f * f;
      } else if (_edgeClientX >= rect.right - RIGHT_EDGE_PX) {
        // 右側：時間式加速（游標頂著畫面右緣，靠停留時間計量）。
        dir = 1;
        const now = performance.now();
        if (_accelStart === 0) _accelStart = now; // 剛進入右側觸發區 → 從慢速重新起步
        const t = Math.min(1, (now - _accelStart) / RIGHT_ACCEL_MS);
        step = MIN_STEP + (RIGHT_MAX_STEP - MIN_STEP) * t * t;
      } else {
        _accelStart = 0; // 離開觸發區 → 重置右側加速，下次重新從慢速起步
      }

      if (dir !== 0) {
        const before = el.scrollLeft;
        el.scrollLeft += dir * step; // 瀏覽器自動 clamp 到 [0, scrollWidth-clientWidth]
        const delta = el.scrollLeft - before;
        if (delta !== 0) onScrolled();
      }
    }
    _rafId = requestAnimationFrame(autoScrollTick);
  }

  function start(): void {
    if (_rafId) return;
    _edgeClientX = Number.NaN;
    _accelStart = 0;
    window.addEventListener('mousemove', onDragMouseMove);
    _rafId = requestAnimationFrame(autoScrollTick);
  }

  function stop(): void {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = 0;
    window.removeEventListener('mousemove', onDragMouseMove);
  }

  onBeforeUnmount(stop);

  return { start, stop };
}

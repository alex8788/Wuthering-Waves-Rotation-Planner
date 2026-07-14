// ============================================================
// useMarquee.ts — 跨三泳道矩形框選（重構 R5）。
//
// 與區塊拖曳徹底隔離：掛 window bubble mousedown（不搶 SortableJS）、
// 按在互動元素上直接 return、位移超過閾值才啟動、進行中才掛 move/up。
// 框選結束後以 window capture 攔截緊接的 terminal click，避免
// App.vue root @click 清掉剛選取的區塊。
// 支援邊緣自動捲動：錨點以「內容座標」為準（記起手 scrollLeft），
// 呼叫端於每次捲動後調用 refreshRect() 重算矩形。
// 自行於 onMounted/onBeforeUnmount 掛卸全域監聽。
// ============================================================

import { ref, onMounted, onBeforeUnmount } from 'vue';

export interface MarqueeRect {
  active: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function useMarquee(options: {
  /** 是否允許啟動框選（例如區塊拖曳中要讓位）。 */
  enabled: () => boolean;
  /** 框選命中結果回呼（additive = Ctrl/Cmd 累加）。 */
  onSelect: (ids: string[], additive: boolean) => void;
  /** 主軸捲動容器目前的 scrollLeft（供邊緣自動捲動時把錨點釘在內容上）。 */
  scrollLeft?: () => number;
  /** 框選啟動/結束通知（呼叫端據此開關邊緣自動捲動）。 */
  onActiveChange?: (active: boolean) => void;
}) {
  /** 框選矩形（fixed 視窗座標，元件據此渲染視覺框）。 */
  const marquee = ref<MarqueeRect>({ active: false, left: 0, top: 0, width: 0, height: 0 });

  let _startX = 0;
  let _startY = 0;
  let _startScrollLeft = 0; // 起手當下的 scrollLeft：捲動後錨點視窗座標＝_startX−(now−start)
  let _lastClientX = 0;
  let _lastClientY = 0;
  let _additive = false;
  let _armed = false;
  let _active = false;
  let _justMarqueed = false;

  function onWindowMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    if (!options.enabled()) return;
    const t = event.target as Element | null;
    if (!t) return;
    // 框選起手區：主軸捲動容器空白處，或頂部標題列空白處。
    // 刻意不含側邊欄（避免與側邊欄拖曳/捲動互搶）。掛在 window bubble，於 target
    // 自身處理（SortableJS 起拖）之後才跑，故不會搶走區塊拖曳。
    if (!t.closest('.board__scroll, .app-header')) return;
    // 按在區塊/互動元素上 → 讓位給 SortableJS（不搶事件）
    if (t.closest('.rotation-block, button, input, textarea, [role="combobox"], .char-selector__listbox')) {
      return;
    }
    _startX = event.clientX;
    _startY = event.clientY;
    _startScrollLeft = options.scrollLeft?.() ?? 0;
    _additive = event.ctrlKey || event.metaKey;
    _armed = true;
    _active = false;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** 以最新游標位置＋目前捲動量重算框選矩形（視窗座標）。
   *  錨點釘在「內容」上：容器向右捲 delta 時，錨點視窗 x 同步左移 delta，
   *  框選範圍才會隨捲動擴大到新露出的內容（僅水平，主軸不垂直捲）。 */
  function updateRect(): void {
    const scrollDelta = (options.scrollLeft?.() ?? 0) - _startScrollLeft;
    const anchorX = _startX - scrollDelta;
    marquee.value = {
      active: true,
      left: Math.min(anchorX, _lastClientX),
      top: Math.min(_startY, _lastClientY),
      width: Math.abs(_lastClientX - anchorX),
      height: Math.abs(_lastClientY - _startY),
    };
  }

  /** 邊緣自動捲動每捲一步後由呼叫端調用：游標未動但內容在動，矩形需重算。 */
  function refreshRect(): void {
    if (_active) updateRect();
  }

  function onMove(event: MouseEvent): void {
    if (!_armed) return;
    _lastClientX = event.clientX;
    _lastClientY = event.clientY;
    if (!_active && Math.abs(event.clientX - _startX) < 5 && Math.abs(event.clientY - _startY) < 5) return;
    if (!_active) {
      _active = true;
      options.onActiveChange?.(true);
    }
    updateRect();
  }

  function onUp(): void {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);

    if (_active) {
      const r = marquee.value;
      const right = r.left + r.width;
      const bottom = r.top + r.height;
      const hit: string[] = [];
      document.querySelectorAll<HTMLElement>('.rotation-block[data-entry-id]').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.left < right && b.right > r.left && b.top < bottom && b.bottom > r.top) {
          const id = el.getAttribute('data-entry-id');
          if (id) hit.push(id);
        }
      });
      options.onSelect(hit, _additive);
      _justMarqueed = true;
      // 防呆：terminal click 會在 mouseup 後同步派發、被 onGlobalClickCapture 消化；
      // 但若 click 始終沒派發（例如鬆手在瀏覽器視窗外），旗標需自行清除，
      // 以免殘留而誤吞下一次正常點擊。
      setTimeout(() => { _justMarqueed = false; }, 0);
    }

    if (_active) options.onActiveChange?.(false);
    _armed = false;
    _active = false;
    marquee.value = { active: false, left: 0, top: 0, width: 0, height: 0 };
  }

  // 框選剛結束時，攔截緊接的 click（避免 App.vue root @click 清掉剛選取的區塊）。
  // 必須掛在 window capture：放開點在 .rotation-board 外時（例如往上框選最頂泳道、
  // 在 board 上緣外鬆手），terminal click 的事件路徑不經過 .rotation-board，
  // 若只掛在 board 上會攔不到而讓 app-root @click 清掉選取。window capture 是
  // 事件分派的最外層，無論 click 落在何處都能搶先攔下。
  function onGlobalClickCapture(event: MouseEvent): void {
    if (_justMarqueed) {
      event.stopPropagation();
      _justMarqueed = false;
    }
  }

  onMounted(() => {
    // 框選起手：掛 window bubble（起點區由處理器內 closest 限定為主軸/標題列空白）。
    window.addEventListener('mousedown', onWindowMouseDown);
    window.addEventListener('click', onGlobalClickCapture, true);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('mousedown', onWindowMouseDown);
    window.removeEventListener('click', onGlobalClickCapture, true);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  });

  return { marquee, refreshRect };
}

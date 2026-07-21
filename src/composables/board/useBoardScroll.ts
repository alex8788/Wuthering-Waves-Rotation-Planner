// ============================================================
// useBoardScroll.ts
// 主軸橫向捲動的共用工具：把指定區塊平滑捲入可視軌道區。
//
// 主軸橫向捲動容器為 .board__scroll，左側泳道 header 為 sticky 會覆蓋
// 容器左緣，故不用原生 scrollIntoView（會把目標推到 header 底下），
// 改手動計算 scrollLeft：
//   目標 scrollLeft = 區塊在內容座標的中心 − 可視軌道區（header 右側）的中心
// 再 clamp 到 [0, maxScrollLeft]；已捲到任一邊緣時自然停在邊界（不強制置中）。
//
// 供「貼上定位（useClipboard）」與「區塊巡覽（useBlockNavigation）」共用。
// ============================================================

import { nextTick } from 'vue';

interface ScrollOptions {
  /**
   * true 時只在目標「未完整落在可視軌道區內」才捲動，已可見則不動鏡頭
   * （區塊巡覽用：不在畫面內才跟隨）；預設 false = 一律置中（貼上定位用）。
   */
  onlyIfNeeded?: boolean;
}

export function useBoardScroll() {
  /** 等 DOM 更新後把指定區塊水平捲到可視軌道區中央（onlyIfNeeded 時已可見則不動）。 */
  function scrollEntryIntoView(
    entryId: string | undefined,
    options: ScrollOptions = {},
  ): void {
    if (!entryId) return;
    scrollSelectorIntoView(`.rotation-block[data-entry-id="${entryId}"]`, options);
  }

  /** 通用版：等 DOM 更新後把任意選擇器命中的元素水平捲到可視軌道區中央
   *  （熱鍵輸入模式用於置中幽靈格——落點非區塊、無 entryId 可查）。 */
  function scrollSelectorIntoView(selector: string, options: ScrollOptions = {}): void {
    nextTick(() => {
      const el = document.querySelector<HTMLElement>(selector);
      const scroll = document.querySelector<HTMLElement>('.board__scroll');
      if (!el || !scroll) return;

      const scrollRect = scroll.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      // sticky header 寬度（可視軌道區＝容器寬扣掉 header）；讀實際 DOM 較硬編碼穩。
      const headerW =
        scroll.querySelector<HTMLElement>('.swimlane__header')?.getBoundingClientRect()
          .width ?? 0;

      // onlyIfNeeded：目標若已完整落在可視軌道區（header 右側 ~ 容器右緣）內，不捲動。
      if (options.onlyIfNeeded) {
        const trackLeft = scrollRect.left + headerW;
        const trackRight = scrollRect.right;
        if (elRect.left >= trackLeft && elRect.right <= trackRight) return;
      }

      // 區塊中心在「捲動內容座標系」的位置
      const elCenterInContent =
        scroll.scrollLeft + (elRect.left - scrollRect.left) + elRect.width / 2;
      // 可視軌道區（header 右側）的中心
      const visibleCenter = headerW + (scrollRect.width - headerW) / 2;

      const maxScrollLeft = scroll.scrollWidth - scroll.clientWidth;
      const target = Math.max(0, Math.min(elCenterInContent - visibleCenter, maxScrollLeft));
      scroll.scrollTo({ left: target, behavior: 'smooth' });
    });
  }

  return { scrollEntryIntoView, scrollSelectorIntoView };
}

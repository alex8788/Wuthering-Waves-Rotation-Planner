// ============================================================
// useBlockNavigation.ts
// 區塊巡覽 (Block Navigation)：用鍵盤在主軸上逐塊左右移動選取。
//
// 橫向視覺順序 = rotationStore.entries 陣列順序（每個 entry 的陣列索引
// 即其欄位／水平位置，三條泳道共用同一水平時間軸）。故「左/右一塊」
// ＝沿 entries 陣列前後移動一格。
//
// 行為（focusStep）：
//   - 無選取：A(左) → 選最右塊；D(右) → 選最左塊（循環起點）。
//   - 有選取：清除選取，改選單一相鄰塊。
//       A 以選取群「最左塊」為基準往左一格；D 以「最右塊」為基準往右一格。
//   - 跨邊界循環：最左按 A 迴繞到最右；最右按 D 迴繞到最左。
//   - 目標塊不在可視範圍時，鏡頭平滑跟隨（onlyIfNeeded）。
//
// 泳道巡覽（focusLaneStep，W/S）：依顯示順序在已選角泳道間循環選取整條泳道；
// 泳道選取與區塊選取互斥（狀態見 rotationStore.selectedLaneIndex）。
// ============================================================

import { useRotationStore } from '@/stores/useRotationStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { useBoardScroll } from '@/composables/board/useBoardScroll';
import { useLaneOrder } from '@/composables/state/useLaneOrder';

export function useBlockNavigation() {
  const rotationStore = useRotationStore();
  const characterStore = useCharacterStore();
  const { laneOrder } = useLaneOrder();
  const { scrollEntryIntoView } = useBoardScroll();

  /**
   * focusStep：往指定方向移動單一選取焦點。
   * @param direction -1 = 左（A）；1 = 右（D）
   */
  function focusStep(direction: -1 | 1): void {
    const entries = rotationStore.entries;
    const n = entries.length;
    if (n === 0) return;

    // 目前選取在主軸中的索引集合（依 selectedIds）。
    const selected = rotationStore.selectedIds;
    const selectedIdx: number[] = [];
    entries.forEach((e, i) => {
      if (selected.has(e.id)) selectedIdx.push(i);
    });

    let target: number;
    if (selectedIdx.length === 0) {
      // 無選取：A → 最右；D → 最左。
      target = direction === -1 ? n - 1 : 0;
    } else {
      // 有選取：A 以最左塊為基準、D 以最右塊為基準，往該方向一格（循環）。
      const base = direction === -1 ? Math.min(...selectedIdx) : Math.max(...selectedIdx);
      target = (base + direction + n) % n;
    }

    const id = entries[target].id;
    rotationStore.selectBlock(id); // 預設 isMultiSelect=false → 先清空再選單一塊
    scrollEntryIntoView(id, { onlyIfNeeded: true });
  }

  /**
   * focusLaneStep：單一泳道巡覽（W/S）——依畫面上下顯示順序（laneOrder）在
   * 「已選角」的泳道間循環選取整條泳道；一併清除區塊選取（selectLane 內處理）。
   * @param direction -1 = 上（W）；1 = 下（S）
   */
  function focusLaneStep(direction: -1 | 1): void {
    // 候選＝顯示順序中已選角的泳道（未選角泳道無區塊可操作，跳過）。
    const candidates = laneOrder.value.filter(
      (si) => characterStore.slots[si].character !== null,
    );
    if (candidates.length === 0) return;

    const current = rotationStore.selectedLaneIndex;
    const currentIdx = current === null ? -1 : candidates.indexOf(current);
    const target =
      currentIdx === -1
        ? // 無泳道選取：S(下) → 最上；W(上) → 最下（循環起點，與 A/D 邏輯對稱）。
          direction === 1
          ? candidates[0]
          : candidates[candidates.length - 1]
        : candidates[(currentIdx + direction + candidates.length) % candidates.length];

    rotationStore.selectLane(target);
  }

  return { focusStep, focusLaneStep };
}

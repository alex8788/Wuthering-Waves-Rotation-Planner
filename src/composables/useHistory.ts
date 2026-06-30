// ============================================================
// useHistory.ts
// Undo / Redo 歷史（module 單例）。
//
// 【模型】past 堆疊保存「每次變更發生前」的狀態快照，future 保存被 undo
// 退回的狀態。任一可記錄操作執行前，先把當下狀態壓入 past；undo 時把當下
// 狀態壓入 future、再套用 past 頂端；redo 反向。past/future 上限各 30 步。
//
// 【階段一範圍】目前只納入 rotationStore.entries（時間軸增刪改移貼）。
// laneOrder、characterStore.slots 留待階段二。
//
// 【合併同一批次】一個使用者操作可能觸發多次 store 寫入（例如一次拖曳落定
// 在同一個同步 setTimeout 內連呼多次 instantiateBlock，或 updateLabel 內部
// 再呼 deleteBlock）。以 microtask 旗標讓「同一同步批次」只記一步。
//
// 【不持久化】純 in-memory，未來「保存隊伍排軸」載入時會 clear()。
// ============================================================

import { ref, computed } from 'vue';
import { deepClone } from '@/utils/deepClone';
import { useRotationStore } from '@/stores/useRotationStore';
import type { RotationArray } from '@/types/rotation';

/** past / future 各自的最大保存步數。 */
const MAX_HISTORY = 30;

interface Snapshot {
  entries: RotationArray;
}

// 模組層級單例：整個 App 共用同一份歷史。
const past = ref<Snapshot[]>([]);
const future = ref<Snapshot[]>([]);

// 同一同步批次只記一步：第一次 record 後設旗標，排程於下個 microtask 復位。
let _coalescing = false;
// 套用快照（undo/redo）期間抑制 record，避免把「還原動作」本身又記成歷史。
let _applying = false;

export function useHistory() {
  function _snapshot(): Snapshot {
    const store = useRotationStore();
    return { entries: deepClone(store.entries) };
  }

  function _apply(snap: Snapshot): void {
    const store = useRotationStore();
    _applying = true;
    store.entries = deepClone(snap.entries);
    // 套用後選取／編輯態可能指向已不存在的 id，一律清空避免懸空參照。
    store.clearSelection();
    store.stopEditing();
    _applying = false;
  }

  /** record：在「變更發生前」呼叫，將當下狀態壓入 past（同批次只記一次）。 */
  function record(): void {
    if (_applying) return; // undo/redo 套用期間不記錄
    if (_coalescing) return; // 同一同步批次已記過
    _coalescing = true;
    queueMicrotask(() => {
      _coalescing = false;
    });

    past.value.push(_snapshot());
    if (past.value.length > MAX_HISTORY) past.value.shift();
    future.value = []; // 新分支產生，清掉可重做的未來
  }

  function undo(): void {
    if (past.value.length === 0) return;
    future.value.push(_snapshot());
    if (future.value.length > MAX_HISTORY) future.value.shift();
    _apply(past.value.pop()!);
  }

  function redo(): void {
    if (future.value.length === 0) return;
    past.value.push(_snapshot());
    if (past.value.length > MAX_HISTORY) past.value.shift();
    _apply(future.value.pop()!);
  }

  /** clear：清空全部歷史（例如載入新隊伍時）。 */
  function clear(): void {
    past.value = [];
    future.value = [];
  }

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  return { record, undo, redo, clear, canUndo, canRedo };
}

// ============================================================
// useHistory.ts — Undo / Redo 歷史（module 單例）。
//
// 模型：past 存「每次變更前」快照，future 存被 undo 退回的狀態；
//       操作前壓入 past，undo 把當下壓入 future 再套 past 頂端，redo 反向。
//       past/future 上限各 30 步。
//
// 設計原則：
//   - 快照範圍（全軸共用單一歷史）：rotationStore.axes、activeAxisId、
//     useLaneOrder.laneOrder、characterStore.slots。
//   - 同一同步批次只記一步：以 microtask 旗標合併（一次拖曳/一次命名可能觸發
//     多次 store 寫入）。
//   - 交易（pending）：跨多 tick 的複合操作（新增空白區塊→首次命名/放棄）用
//     beginPending 暫存、commit/cancel 收尾成單一步驟。
//   - 純 in-memory，不持久化。
// ============================================================

import { ref, computed } from 'vue';
import { deepClone } from '@/utils/deepClone';
import { useRotationStore } from '@/stores/useRotationStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { useLaneOrder } from '@/composables/state/useLaneOrder';
import { useSettings } from '@/composables/state/useSettings';
import { showToast } from '@/composables/state/useToast';
import { t } from '@/i18n';
import type { RotationAxis } from '@/types/rotation';
import type { CharacterSlots, SlotIndex } from '@/types/character';

/** past / future 各自的最大保存步數（可由設定調整，見 useSettings.historyLimit）。 */
function maxHistory(): number {
  return useSettings().settings.value.historyLimit;
}
/** 把佇列裁到目前上限（上限調低時亦於下次入列自動收斂）。 */
function trimHistory(queue: Snapshot[]): void {
  const max = maxHistory();
  while (queue.length > max) queue.shift();
}

interface Snapshot {
  axes: RotationAxis[];
  activeAxisId: string;
  laneOrder: SlotIndex[];
  slots: CharacterSlots;
}

// 模組層級單例：整個 App 共用同一份歷史。
const past = ref<Snapshot[]>([]);
const future = ref<Snapshot[]>([]);

// 同批次合併旗標：第一次 record 後設，排程於下個 microtask 復位。
let _coalescing = false;
// 套用快照期間抑制 record，避免把「還原動作」本身記成歷史。
let _applying = false;
// 交易暫存快照（尚未入 past）；非 null 期間所有 record() 被抑制。
let _pending: Snapshot | null = null;

export function useHistory() {
  function _snapshot(): Snapshot {
    const store = useRotationStore();
    const characterStore = useCharacterStore();
    const { laneOrder } = useLaneOrder();
    return {
      axes: deepClone(store.axes),
      activeAxisId: store.activeAxisId,
      laneOrder: deepClone(laneOrder.value),
      slots: deepClone(characterStore.slots),
    };
  }

  function _apply(snap: Snapshot): void {
    const store = useRotationStore();
    const characterStore = useCharacterStore();
    const { laneOrder } = useLaneOrder();
    _applying = true;
    store.axes = deepClone(snap.axes);
    // 還原作用中軸 → undo/redo 自動聚焦到變更發生的輸出軸頁面。
    store.activeAxisId = snap.activeAxisId;
    laneOrder.value = deepClone(snap.laneOrder);
    characterStore.slots = deepClone(snap.slots);
    // 套用後選取／編輯態可能指向已不存在的 id，一律清空避免懸空參照。
    store.clearSelection();
    store.stopEditing();
    _applying = false;
  }

  /** record：在「變更發生前」呼叫，將當下狀態壓入 past（同批次只記一次）。 */
  function record(): void {
    if (_applying) return; // undo/redo 套用期間不記錄
    if (_pending) return; // 交易進行中：建立／命名／放棄都不各自記錄
    if (_coalescing) return; // 同一同步批次已記過
    _coalescing = true;
    queueMicrotask(() => {
      _coalescing = false;
    });

    past.value.push(_snapshot());
    trimHistory(past.value);
    future.value = []; // 新分支產生，清掉可重做的未來
  }

  function undo(): void {
    if (past.value.length === 0) return;
    future.value.push(_snapshot());
    trimHistory(future.value);
    _apply(past.value.pop()!);
    showToast(t('toast.undone'), 'info');
  }

  function redo(): void {
    if (future.value.length === 0) return;
    past.value.push(_snapshot());
    trimHistory(past.value);
    _apply(future.value.pop()!);
    showToast(t('toast.redone'), 'info');
  }

  /**
   * beginPending：開啟一筆交易，封存「操作前」快照暫存（尚未入 past）。
   * 期間所有 record() 被抑制，直到 commitPending / cancelPending 收尾。
   */
  function beginPending(): void {
    // 理論上不會有殘留交易（行內編輯為焦點獨佔）；保險起見先提交避免遺失。
    if (_pending) commitPending();
    _pending = _snapshot();
  }

  /** commitPending：把暫存快照推入 past，成為單一可復原步驟。無交易則 no-op。 */
  function commitPending(): void {
    if (!_pending) return;
    past.value.push(_pending);
    trimHistory(past.value);
    future.value = []; // 新分支產生，清掉可重做的未來
    _pending = null;
  }

  /** cancelPending：整筆丟棄暫存快照，不留任何歷史。無交易則 no-op。 */
  function cancelPending(): void {
    _pending = null;
  }

  /** clear：清空全部歷史（例如載入新隊伍時）。 */
  function clear(): void {
    past.value = [];
    future.value = [];
    _pending = null;
  }

  /** snapshotStacks / restoreStacks：暫存與還原 undo/redo 佇列
   *  （導覽示範會用真實動作污染歷史，結束時據此完整還原使用者原歷史）。 */
  function snapshotStacks(): { past: Snapshot[]; future: Snapshot[]; pending: Snapshot | null } {
    return { past: [...past.value], future: [...future.value], pending: _pending };
  }
  function restoreStacks(s: { past: Snapshot[]; future: Snapshot[]; pending: Snapshot | null }): void {
    past.value = [...s.past];
    future.value = [...s.future];
    _pending = s.pending;
  }

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  return { record, beginPending, commitPending, cancelPending, undo, redo, clear, snapshotStacks, restoreStacks, canUndo, canRedo };
}

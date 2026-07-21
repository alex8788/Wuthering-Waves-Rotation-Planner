// ============================================================
// useHotkeyInputMode.ts — 熱鍵輸入模式（module 單例）。
//
// 職責：模式開關狀態 ＋ 模式中的鍵盤輸入分派（插入區塊／切泳道／刪除／退出）。
// 設計決策（見 DesignDocument/HotkeyInputMode.md）：
//   - 對映以 label 為準（非模板 id）：命中即呼叫 addFreeformBlock 插入自由區塊，
//     不需處理模板刪改的懸空引用。
//   - 鍵位比對用 event.code（物理鍵），免疫 CapsLock 與輸入法。
//   - 泳道選中直接重用 rotationStore.selectedLaneIndex（沿用青色焦點環視覺）。
//   - Stage 1 對映表暫時寫死（Stage 2 改讀設定 store）。
//   - 模式中既有快捷鍵全數停用：useKeyboardShortcuts 分派器見 active 即短路
//     改呼叫 handleModeKeydown。
// ============================================================

import { computed, ref } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { useLaneOrder } from '@/composables/state/useLaneOrder';
import { useHistory } from '@/composables/state/useHistory';
import { useSidebarCollapse } from '@/composables/state/useSidebarCollapse';
import { useBoardScroll } from '@/composables/board/useBoardScroll';
import { getElementColor } from '@/constants/elements';
import type { SlotIndex } from '@/types/character';

/** Stage 1 暫時寫死的對映表：event.code → 插入的區塊文字（Stage 2 改讀設定）。 */
const STAGE1_HOTKEY_MAP: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'KeyA', label: 'A' },
  { code: 'KeyZ', label: 'Z' },
  { code: 'KeyE', label: 'E' },
  { code: 'KeyR', label: 'R' },
  { code: 'KeyQ', label: 'Q' },
  { code: 'KeyD', label: 'D' },
  { code: 'KeyS', label: 'Intro' },
];

// 模組層級單例：模式開關（整個 App 共用同一份）。
const active = ref(false);
// 進入模式前側邊欄是否已收合：退出時據此還原（模式自動收合側欄爭取軸面寬度）。
let _sidebarWasCollapsed = false;
// 側欄收合的欄寬過渡時長（AppLayout transition 0.25s）：進場置中捲動須等
// 版面定型後再算，否則以過渡中的寬度計算會偏。
const SIDEBAR_TRANSITION_MS = 300;

export function useHotkeyInputMode() {
  const rotationStore = useRotationStore();
  const characterStore = useCharacterStore();
  const history = useHistory();
  const { laneOrder } = useLaneOrder();
  const sidebarCollapse = useSidebarCollapse();
  const { scrollSelectorIntoView } = useBoardScroll();

  /** 可選中的泳道（已選角），依畫面上下顯示順序排列。 */
  const selectableLanes = computed<SlotIndex[]>(() =>
    laneOrder.value.filter((si) => characterStore.slots[si].character !== null),
  );

  /**
   * 補選泳道：維持「模式中永遠恰有一條泳道被選中」的不變量。
   * preferred 仍可選則沿用，否則落到第一條可選泳道；全空＝模式無意義，退出。
   * 進入模式與 undo/redo 後（useHistory._apply 會清空選取）都經此收斂。
   */
  function ensureLaneSelected(preferred: SlotIndex | null): void {
    const lanes = selectableLanes.value;
    if (lanes.length === 0) {
      exit();
      return;
    }
    const lane = preferred !== null && lanes.includes(preferred) ? preferred : lanes[0];
    rotationStore.selectLane(lane);
  }

  /** 把插入落點（幽靈格）水平置中於可視軌道區。 */
  function centerGhostCell(): void {
    scrollSelectorIntoView('.track__ghost-cell');
  }

  /** 進入模式：預設選中畫面上第一條有選角的泳道；全空則不進入。 */
  function enter(): void {
    if (active.value) return;
    if (selectableLanes.value.length === 0) return; // 無任何角色可插入 → 模式無意義，不進入
    active.value = true;
    ensureLaneSelected(rotationStore.selectedLaneIndex);
    // 自動收合側邊欄爭取軸面寬度；退出時還原原本的收合狀態。
    _sidebarWasCollapsed = sidebarCollapse.collapsed.value;
    sidebarCollapse.collapsed.value = true;
    // 等欄寬過渡定型後，把插入落點置中（過渡中量測會以瞬時寬度計算而偏掉）。
    window.setTimeout(() => {
      if (active.value) centerGhostCell();
    }, SIDEBAR_TRANSITION_MS);
  }

  /** 退出模式：清掉泳道選取、還原側欄收合狀態，回復一切既有行為。 */
  function exit(): void {
    if (!active.value) return;
    active.value = false;
    rotationStore.selectLane(null);
    sidebarCollapse.collapsed.value = _sidebarWasCollapsed;
  }

  /** 切換至畫面上第 n 條（0-based 顯示序）泳道；未選角則跳過（不動作）。 */
  function setLaneByDisplayIndex(displayIndex: number): void {
    const slot = laneOrder.value[displayIndex];
    if (slot === undefined) return;
    if (!selectableLanes.value.includes(slot)) return;
    rotationStore.selectLane(slot);
  }

  /** 上一條/下一條已選角泳道（依顯示順序循環）。 */
  function cycleLane(direction: 1 | -1): void {
    const lanes = selectableLanes.value;
    if (lanes.length === 0) return;
    const idx = lanes.indexOf(rotationStore.selectedLaneIndex as SlotIndex);
    const next = idx === -1 ? 0 : (idx + direction + lanes.length) % lanes.length;
    rotationStore.selectLane(lanes[next]);
  }

  /** 依對映表插入區塊至選中泳道（＝1D 陣列末尾）；命中回 true。 */
  function insertByCode(code: string): boolean {
    const entry = STAGE1_HOTKEY_MAP.find((m) => m.code === code);
    if (!entry || entry.label.trim() === '') return false;
    const lane = rotationStore.selectedLaneIndex;
    if (lane === null) return false;
    const character = characterStore.slots[lane].character;
    if (!character) return false;
    // addFreeformBlock 自帶 history.record() → 一鍵一步 undo。
    rotationStore.addFreeformBlock(
      entry.label,
      getElementColor(character.element),
      lane,
      character.id,
      rotationStore.entries.length - 1,
    );
    // 自動跟隨：每次插入後把「下一個落點」（幽靈格）置中於可視軌道區。
    centerGhostCell();
    return true;
  }

  /** 刪除選中泳道的最後一個區塊（依 slotIndex 過濾後的最後一項）。 */
  function deleteLastInLane(): void {
    const lane = rotationStore.selectedLaneIndex;
    if (lane === null) return;
    const laneEntries = rotationStore.entries.filter((e) => e.slotIndex === lane);
    const last = laneEntries[laneEntries.length - 1];
    if (last) {
      rotationStore.deleteBlock(last.id);
      centerGhostCell(); // 欄位收合後落點重新置中
    }
  }

  /**
   * 模式中的 keydown 分派（由 useKeyboardShortcuts 短路轉呼叫）。
   * 僅保留：對映熱鍵／1-2-3 切泳道／Delete 刪末塊／Esc 退出／Ctrl+Z 系復原。
   * 未命中的按鍵不動作也不 preventDefault（瀏覽器原生行為如 F5 不受影響）。
   */
  function handleModeKeydown(event: KeyboardEvent): void {
    const isMac = navigator.userAgent.toUpperCase().includes('MAC OS');
    const isCtrl = isMac ? event.metaKey : event.ctrlKey;

    if (isCtrl) {
      const k = event.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        event.preventDefault();
        // undo/redo 套用快照後會清空所有選取（useHistory._apply 防懸空參照），
        // 模式的泳道選取須自行補回：記住套用前的泳道、事後收斂補選。
        const laneBefore = rotationStore.selectedLaneIndex;
        if (k === 'y' || event.shiftKey) history.redo();
        else history.undo();
        ensureLaneSelected(laneBefore);
        if (active.value) centerGhostCell(); // undo 可能大幅增刪區塊 → 落點重新置中
      }
      return; // 其餘 Ctrl 組合：模式中一律不動作
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      exit();
      return;
    }

    if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3') {
      event.preventDefault();
      setLaneByDisplayIndex(Number(event.code.slice(-1)) - 1);
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteLastInLane();
      return;
    }

    // 長按不連發：忽略作業系統的鍵盤自動重複。
    if (event.repeat) return;
    if (event.altKey) return;

    if (insertByCode(event.code)) event.preventDefault();
  }

  return {
    active,
    selectableLanes,
    enter,
    exit,
    cycleLane,
    handleModeKeydown,
  };
}

// ============================================================
// useSavedTeamStore.ts — 隊伍存檔管理（Pinia）。
//
// 職責：把當前完整工作狀態（角色槽 + 所有輸出軸 + 泳道順序）快照為具名存檔、
// 列出/置頂/刪除/改名、載入（覆蓋當前工作區）、LocalStorage 持久化。
// 持久化樣式比照 useTemplateStore（try/catch 讀、deep watch 寫）。
//
// 「當前隊伍」機制：載入/另存/覆蓋/建立空隊伍後，記住正在編輯的存檔 id
// （currentTeamId，另存於 LocalStorage）。修改留在工作區、不自動寫回；按「儲存
// 變更」才覆蓋回該存檔。isDirty 比對工作區與存檔快照，供 UI 判斷是否有未存變更、
// 並在載入他檔/建空隊等會捨棄內容的動作前跳警告。無綁定（自由模式）時，isDirty
// 退化為「工作區是否有任何內容」。
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { SavedTeam } from '../types/savedTeam';
import type { CharacterSlots, SlotIndex } from '../types/character';
import { generateUUID } from '../utils/uuid';
import { deepClone } from '../utils/deepClone';
import { t } from '@/i18n';
import { useRotationStore } from './useRotationStore';
import { useCharacterStore } from './useCharacterStore';
import { useLaneOrder } from '@/composables/state/useLaneOrder';
import { useHistory } from '@/composables/state/useHistory';

/** LocalStorage 儲存鍵名。 */
const STORAGE_KEY = 'wuwa-rotation-saved-teams';
/** 「當前正在編輯的存檔 id」持久化鍵名。 */
const CURRENT_KEY = 'wuwa-rotation-current-team';

/** 完整工作狀態快照的四個欄位（存檔與工作區共用的比對單元）。 */
interface StateSnapshot {
  slots: CharacterSlots;
  axes: SavedTeam['axes'];
  activeAxisId: string;
  laneOrder: SlotIndex[];
}

/** 從 LocalStorage 讀存檔；不存在或損壞時回空陣列。 */
function loadFromStorage(): SavedTeam[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTeam[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[useSavedTeamStore] LocalStorage 讀取失敗，使用空存檔庫', e);
    return [];
  }
}

/** 從 LocalStorage 讀當前隊伍 id（可能為 null）。 */
function loadCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY) || null;
  } catch {
    return null;
  }
}

export const useSavedTeamStore = defineStore('savedTeams', () => {
  /** 所有隊伍存檔；從 LocalStorage 初始化。 */
  const teams = ref<SavedTeam[]>(loadFromStorage());

  /** 當前正在編輯的存檔 id（null＝自由模式，未綁定任何存檔）。 */
  const currentTeamId = ref<string | null>(loadCurrentId());
  // 開檔時驗證持久化的 id 仍存在，避免指向已刪除的存檔。
  if (currentTeamId.value && !teams.value.some((t) => t.id === currentTeamId.value)) {
    currentTeamId.value = null;
  }

  // 變動自動同步 LocalStorage（deep watch 以捕捉物件內部變更）。
  watch(
    teams,
    (newTeams) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newTeams));
      } catch (e) {
        console.warn('[useSavedTeamStore] LocalStorage 寫入失敗', e);
      }
    },
    { deep: true }
  );

  // 當前隊伍 id 同步持久化。
  watch(currentTeamId, (id) => {
    try {
      if (id) localStorage.setItem(CURRENT_KEY, id);
      else localStorage.removeItem(CURRENT_KEY);
    } catch (e) {
      console.warn('[useSavedTeamStore] 當前隊伍 id 寫入失敗', e);
    }
  });

  /** 顯示用排序：置頂優先，其次依 updatedAt 新→舊。 */
  const sortedTeams = computed<SavedTeam[]>(() =>
    [...teams.value].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    })
  );

  /** 當前綁定的存檔物件（自由模式回 null）。 */
  const currentTeam = computed<SavedTeam | null>(
    () => teams.value.find((t) => t.id === currentTeamId.value) ?? null
  );

  /** 擷取當前工作區的完整狀態快照（深拷貝，reactive-safe）。 */
  function captureState(): StateSnapshot {
    const rotationStore = useRotationStore();
    const characterStore = useCharacterStore();
    const { laneOrder } = useLaneOrder();
    return {
      slots: deepClone(characterStore.slots),
      axes: deepClone(rotationStore.axes),
      activeAxisId: rotationStore.activeAxisId,
      laneOrder: deepClone(laneOrder.value),
    };
  }

  /** 把狀態快照序列化為字串，供內容比對（忽略名稱/時間等 meta 欄位）。 */
  function serializeState(s: StateSnapshot): string {
    return JSON.stringify({
      slots: s.slots,
      axes: s.axes,
      activeAxisId: s.activeAxisId,
      laneOrder: s.laneOrder,
    });
  }

  /** 工作區是否有任何內容（任一軸有區塊、或任一槽已選角）。 */
  function workingAreaHasContent(): boolean {
    const rotationStore = useRotationStore();
    const characterStore = useCharacterStore();
    return (
      rotationStore.axes.some((a) => a.entries.length > 0) ||
      characterStore.slots.some((s) => s.character != null)
    );
  }

  /**
   * 工作區是否有「未儲存變更」。
   * - 已綁定存檔：工作區內容 ≠ 存檔內容即為 true。
   * - 自由模式：工作區有任何內容即為 true（載入他檔會蓋掉這些內容）。
   */
  const isDirty = computed<boolean>(() => {
    const team = currentTeam.value;
    if (!team) return workingAreaHasContent();
    return serializeState(captureState()) !== serializeState(team);
  });

  /** 名稱是否已被使用（trim 後比對；exceptId 可排除自身，供改名檢查）。 */
  function isNameTaken(name: string, exceptId?: string): boolean {
    const trimmed = name.trim();
    if (trimmed === '') return false;
    return teams.value.some((t) => t.id !== exceptId && t.name.trim() === trimmed);
  }

  /**
   * 把當前完整工作狀態快照為新存檔（另存新檔）；回傳新 id（重名則不建立、回 null）。
   * 另存後綁定為當前隊伍。
   */
  function saveCurrent(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed === '' || isNameTaken(trimmed)) return null;

    const now = Date.now();
    const team: SavedTeam = {
      id: generateUUID(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      ...captureState(),
    };
    teams.value = [...teams.value, team];
    currentTeamId.value = team.id;
    return team.id;
  }

  /**
   * 以當前工作區內容覆蓋指定存檔；回傳是否成功（找不到則 false）。
   * 覆蓋後綁定為當前隊伍。供「儲存變更」（覆蓋當前隊伍）與「以目前內容覆蓋」共用。
   */
  function overwriteTeam(id: string): boolean {
    const target = teams.value.find((t) => t.id === id);
    if (!target) return false;
    const snapshot = captureState();
    teams.value = teams.value.map((t) =>
      t.id === id ? { ...t, ...snapshot, updatedAt: Date.now() } : t
    );
    currentTeamId.value = id;
    return true;
  }

  /** 儲存變更：以當前工作區覆蓋回「當前隊伍」；未綁定或找不到則回 false。 */
  function saveToCurrent(): boolean {
    if (!currentTeamId.value) return false;
    return overwriteTeam(currentTeamId.value);
  }

  /**
   * 建立空隊伍：無角色、單一空白軸的新存檔，建立後立即載入編輯。
   * 回傳新 id（重名或空名回 null）。
   */
  function createEmptyTeam(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed === '' || isNameTaken(trimmed)) return null;

    const now = Date.now();
    const axisId = generateUUID();
    const team: SavedTeam = {
      id: generateUUID(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      slots: [
        { slotIndex: 0, character: null },
        { slotIndex: 1, character: null },
        { slotIndex: 2, character: null },
      ],
      axes: [{ id: axisId, name: t('axis.defaultName', { n: 1 }), entries: [] }],
      activeAxisId: axisId,
      laneOrder: [0, 1, 2],
    };
    teams.value = [...teams.value, team];
    loadTeam(team.id);
    return team.id;
  }

  /** 載入存檔：覆蓋當前工作區（可由 Undo 還原），並綁定為當前隊伍。 */
  function loadTeam(id: string): void {
    const team = teams.value.find((t) => t.id === id);
    if (!team) return;

    const rotationStore = useRotationStore();
    const characterStore = useCharacterStore();
    const { laneOrder } = useLaneOrder();

    // 套用前記錄快照 → 載入可被 Undo 還原（Snapshot 已含 axes/slots/laneOrder）。
    useHistory().record();

    rotationStore.axes = deepClone(team.axes);
    characterStore.slots = deepClone(team.slots);
    laneOrder.value = deepClone(team.laneOrder);
    // 作用中軸：套用存檔值；若該 id 不存在（防禦）則 setActiveAxis 內部退回首軸。
    rotationStore.setActiveAxis(team.activeAxisId);
    if (rotationStore.activeAxisId !== team.activeAxisId && rotationStore.axes.length) {
      rotationStore.setActiveAxis(rotationStore.axes[0].id);
    }

    rotationStore.clearSelection();
    rotationStore.stopEditing();

    currentTeamId.value = id;
  }

  /** 刪除存檔；若刪的是當前隊伍則解除綁定（工作區內容不動）。 */
  function deleteTeam(id: string): void {
    teams.value = teams.value.filter((t) => t.id !== id);
    if (currentTeamId.value === id) currentTeamId.value = null;
  }

  /** 切換置頂。 */
  function togglePin(id: string): void {
    teams.value = teams.value.map((t) =>
      t.id === id ? { ...t, pinned: !t.pinned, updatedAt: Date.now() } : t
    );
  }

  /** 改名（重名則不變更）。 */
  function renameTeam(id: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed === '' || isNameTaken(trimmed, id)) return;
    teams.value = teams.value.map((t) =>
      t.id === id ? { ...t, name: trimmed, updatedAt: Date.now() } : t
    );
  }

  return {
    teams,
    sortedTeams,
    currentTeamId,
    currentTeam,
    isDirty,
    isNameTaken,
    saveCurrent,
    saveToCurrent,
    overwriteTeam,
    createEmptyTeam,
    loadTeam,
    deleteTeam,
    togglePin,
    renameTeam,
  };
});

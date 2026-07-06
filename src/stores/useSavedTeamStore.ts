// ============================================================
// useSavedTeamStore.ts — 隊伍存檔管理（Pinia）。
//
// 職責：把當前完整工作狀態（角色槽 + 所有輸出軸 + 泳道順序）快照為具名存檔、
// 列出/置頂/刪除/改名、載入（覆蓋當前工作區）、LocalStorage 持久化。
// 持久化樣式比照 useTemplateStore（try/catch 讀、deep watch 寫）。
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { SavedTeam } from '../types/savedTeam';
import { generateUUID } from '../utils/uuid';
import { deepClone } from '../utils/deepClone';
import { useRotationStore } from './useRotationStore';
import { useCharacterStore } from './useCharacterStore';
import { useLaneOrder } from '@/composables/state/useLaneOrder';
import { useHistory } from '@/composables/state/useHistory';

/** LocalStorage 儲存鍵名。 */
const STORAGE_KEY = 'wuwa-rotation-saved-teams';

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

export const useSavedTeamStore = defineStore('savedTeams', () => {
  /** 所有隊伍存檔；從 LocalStorage 初始化。 */
  const teams = ref<SavedTeam[]>(loadFromStorage());

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

  /** 顯示用排序：置頂優先，其次依 updatedAt 新→舊。 */
  const sortedTeams = computed<SavedTeam[]>(() =>
    [...teams.value].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    })
  );

  /** 名稱是否已被使用（trim 後比對；exceptId 可排除自身，供改名檢查）。 */
  function isNameTaken(name: string, exceptId?: string): boolean {
    const trimmed = name.trim();
    if (trimmed === '') return false;
    return teams.value.some((t) => t.id !== exceptId && t.name.trim() === trimmed);
  }

  /** 把當前完整工作狀態快照為新存檔；回傳新 id（重名則不建立、回 null）。 */
  function saveCurrent(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed === '' || isNameTaken(trimmed)) return null;

    const rotationStore = useRotationStore();
    const characterStore = useCharacterStore();
    const { laneOrder } = useLaneOrder();

    const now = Date.now();
    const team: SavedTeam = {
      id: generateUUID(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      slots: deepClone(characterStore.slots),
      axes: deepClone(rotationStore.axes),
      activeAxisId: rotationStore.activeAxisId,
      laneOrder: deepClone(laneOrder.value),
    };
    teams.value = [...teams.value, team];
    return team.id;
  }

  /** 載入存檔：覆蓋當前工作區（可由 Undo 還原）。 */
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
  }

  /** 刪除存檔。 */
  function deleteTeam(id: string): void {
    teams.value = teams.value.filter((t) => t.id !== id);
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
    isNameTaken,
    saveCurrent,
    loadTeam,
    deleteTeam,
    togglePin,
    renameTeam,
  };
});

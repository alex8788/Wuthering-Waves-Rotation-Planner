// ============================================================
// useCharacterStore.ts
// Pinia Store：管理三個角色槽的選角狀態。
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Character, CharacterSlots, SlotIndex } from '../types/character';
import { WUWA_CHARACTERS, CHARACTER_MAP } from '../constants/characters';
import { useHistory } from '../composables/useHistory';

export const useCharacterStore = defineStore('character', () => {
  // ──────────────────────────────────────────
  // State
  // ──────────────────────────────────────────

  /**
   * slots：三個角色槽的狀態，初始均為空（未選角色）。
   * 使用 tuple 型別確保長度固定為 3，對應三條泳道。
   */
  const slots = ref<CharacterSlots>([
    { slotIndex: 0, character: null },
    { slotIndex: 1, character: null },
    { slotIndex: 2, character: null },
  ]);

  // Undo/Redo：換角色（含連帶清空泳道）須可復原。setCharacter 起手記錄變更前快照，
  // 與同批次的 rotationStore.clearSlot 合併為一步（見 useHistory）。
  const history = useHistory();

  // ──────────────────────────────────────────
  // Computed
  // ──────────────────────────────────────────

  /**
   * allCharacters：完整的鳴潮角色名單，供下拉選單使用。
   */
  const allCharacters = computed(() => WUWA_CHARACTERS);

  /**
   * getCharacterBySlot：取得特定槽位的角色（可能為 null）。
   * 回傳 computed 以保持響應性。
   */
  const slotCharacters = computed(() =>
    slots.value.map((slot) => slot.character)
  );

  /**
   * occupiedSlots：已選角色的槽位列表（過濾掉空槽）。
   */
  const occupiedSlots = computed(() =>
    slots.value.filter((slot) => slot.character !== null)
  );

  // ──────────────────────────────────────────
  // Actions
  // ──────────────────────────────────────────

  /**
   * setCharacter：在指定槽位選擇角色。
   *
   * @param slotIndex - 目標槽位索引（0 | 1 | 2）
   * @param characterId - 要選擇的角色 ID（來自 WUWA_CHARACTERS），
   *                      傳入 null 代表清空該槽位
   */
  function setCharacter(slotIndex: SlotIndex, characterId: string | null): void {
    const character = characterId ? (CHARACTER_MAP[characterId] ?? null) : null;

    if (characterId && !character) {
      // 傳入了非法的 characterId，記錄警告
      console.warn(
        `[useCharacterStore.setCharacter] 找不到 characterId: ${characterId}`
      );
      return;
    }

    history.record();
    // 直接更新對應槽位的 character 欄位
    slots.value[slotIndex] = {
      slotIndex,
      character,
    };
  }

  /**
   * clearCharacter：清空指定槽位的角色選擇。
   *
   * @param slotIndex - 要清空的槽位索引
   */
  function clearCharacter(slotIndex: SlotIndex): void {
    setCharacter(slotIndex, null);
  }

  /**
   * getCharacterIdBySlot：取得指定槽位的角色 ID（供 Block 指定 characterId 使用）。
   *
   * @param slotIndex - 槽位索引
   * @returns 角色 ID 字串，若槽位為空則回傳 null
   */
  function getCharacterIdBySlot(slotIndex: SlotIndex): string | null {
    return slots.value[slotIndex].character?.id ?? null;
  }

  /**
   * getSlotByCharacterId：反查某角色目前所在的槽位索引（供模板依角色分流到對應泳道）。
   * 同一角色若佔多槽則回傳第一個；無任何槽位選此角色則回傳 null。
   *
   * @param characterId - 角色 ID
   * @returns 槽位索引，找不到則 null
   */
  function getSlotByCharacterId(characterId: string | null): SlotIndex | null {
    if (!characterId) return null;
    const slot = slots.value.find((s) => s.character?.id === characterId);
    return slot ? (slot.slotIndex as SlotIndex) : null;
  }

  return {
    // State
    slots,
    // Computed
    allCharacters,
    slotCharacters,
    occupiedSlots,
    // Actions
    setCharacter,
    clearCharacter,
    getCharacterIdBySlot,
    getSlotByCharacterId,
  };
});
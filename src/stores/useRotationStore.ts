// ============================================================
// useRotationStore.ts
// 核心 Pinia Store：管理整個 1D 輸出軸陣列（RotationArray）。
//
// 這是本專案最重要的 store，所有對主時間軸的增刪改查都在這裡。
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RotationArray, RotationEntry } from '../types/rotation';
import type { Block, AnyBlock, DefaultBlock, TemplateBlock } from '../types/block';
import type { SlotIndex } from '../types/character';
import { generateUUID } from '../utils/uuid';
import { deepClone } from '../utils/deepClone';
import {
  insertEntryAfterIndex,
  removeEntryById,
  removeEntriesByIds,
  moveEntry,
  findEntryIndexById,
  appendEntry,
} from '../utils/arrayHelpers';

export const useRotationStore = defineStore('rotation', () => {
  // ──────────────────────────────────────────
  // State（響應式狀態）
  // ──────────────────────────────────────────

  /**
   * entries：整個輸出軸的核心 1D 陣列。
   * 所有對時間軸的操作都以更新此陣列為最終目標。
   */
  const entries = ref<RotationArray>([]);

  /**
   * selectedIds：目前被選中的區塊 id 集合。
   * 使用 Set 確保不重複，並讓 has() 操作達到 O(1)。
   */
  const selectedIds = ref<Set<string>>(new Set());

  // ──────────────────────────────────────────
  // Computed（衍生狀態）
  // ──────────────────────────────────────────

  /**
   * totalBlockCount：主時間軸上的總區塊數。
   */
  const totalBlockCount = computed(() => entries.value.length);

  /**
   * selectedEntries：目前被選中的條目列表。
   * 維持在 1D 陣列中的相對時間順序。
   */
  const selectedEntries = computed(() =>
    entries.value.filter((e) => selectedIds.value.has(e.id))
  );

  // ──────────────────────────────────────────
  // Actions（操作方法）
  // ──────────────────────────────────────────

  /**
   * instantiateBlock：從側邊欄區塊建立一個新的 InstanceBlock 並加入時間軸。
   *
   * @param sourceBlock - 來源區塊（DefaultBlock 或 TemplateBlock）
   * @param targetSlotIndex - 要放置的泳道索引
   * @param targetCharacterId - 目標角色 ID
   * @param afterIndex - 插入在哪個索引之後（預設追加末尾）
   */
  function instantiateBlock(
    sourceBlock: DefaultBlock | TemplateBlock,
    targetSlotIndex: SlotIndex,
    targetCharacterId: string,
    afterIndex: number = entries.value.length - 1
  ): void {
    const clonedData = deepClone(sourceBlock);

    const newBlock: Block = {
      ...clonedData,
      id: generateUUID(),             // 賦予全新的泛用識別碼
      source: 'instance',             // 標記來源為「主軸實體」
      characterId: targetCharacterId, // 覆蓋為目標角色
      originId: sourceBlock.id,       // 統一對應來源的泛用 id
      tags: deepClone(clonedData.tags), 
    } as Block;

    const newEntry: RotationEntry = {
      id: newBlock.id,
      slotIndex: targetSlotIndex,
      block: newBlock,
    };

    if (afterIndex >= entries.value.length - 1) {
      entries.value = appendEntry(entries.value, newEntry);
    } else {
      entries.value = insertEntryAfterIndex(entries.value, newEntry, afterIndex);
    }
  }

  /**
   * addFreeformBlock：在主時間軸憑空新增一個空白或自訂文字的實體區塊。
   *
   * 此功能對應「自由輸入與非強制序列化」的設計，originId 刻意設為 null。
   *
   * @param label - 區塊顯示文字
   * @param color - 區塊背景顏色
   * @param targetSlotIndex - 所在的泳道索引
   * @param targetCharacterId - 綁定的角色 ID
   * @param afterIndex - 插入位置
   */
  function addFreeformBlock(
    label: string,
    color: string,
    targetSlotIndex: SlotIndex,
    targetCharacterId: string,
    afterIndex: number = entries.value.length - 1
  ): void {
    const newBlock: Block = {
      id: generateUUID(),
      label,
      color,
      source: 'instance',
      characterId: targetCharacterId,
      originId: null, // 自由新增的區塊無來源
      tags: [],
    };

    const newEntry: RotationEntry = {
      id: newBlock.id,
      slotIndex: targetSlotIndex,
      block: newBlock,
    };

    if (afterIndex >= entries.value.length - 1) {
      entries.value = appendEntry(entries.value, newEntry);
    } else {
      entries.value = insertEntryAfterIndex(entries.value, newEntry, afterIndex);
    }
  }

  /**
   * moveBlock：在主時間軸內移動一個區塊（排序操作）。
   * 允許跨泳道移動，跨泳道時會一併更新 slotIndex 與 characterId。
   */
  function moveBlock(
    id: string,
    toInsertAfterIndex: number,
    newSlotIndex?: SlotIndex,
    newCharacterId?: string
  ): void {
    const fromIndex = findEntryIndexById(entries.value, id);

    if (fromIndex === -1) {
      console.warn(`[useRotationStore.moveBlock] 找不到 id: ${id}`);
      return;
    }

    let newEntries = moveEntry(entries.value, fromIndex, toInsertAfterIndex);

    if (newSlotIndex !== undefined || newCharacterId !== undefined) {
      newEntries = newEntries.map((entry) => {
        if (entry.id !== id) return entry;
        return {
          ...entry,
          slotIndex: newSlotIndex ?? entry.slotIndex,
          block: {
            ...entry.block,
            characterId: newCharacterId ?? entry.block.characterId,
          },
        };
      });
    }

    entries.value = newEntries;
  }

  /**
   * deleteBlock：從主時間軸刪除單一區塊。
   */
  function deleteBlock(id: string): void {
    entries.value = removeEntryById(entries.value, id);
    selectedIds.value.delete(id);
  }

  /**
   * deleteSelectedBlocks：批量刪除目前所有被選中的區塊。
   */
  function deleteSelectedBlocks(): void {
    const idsToDelete = [...selectedIds.value];
    entries.value = removeEntriesByIds(entries.value, idsToDelete);
    selectedIds.value.clear();
  }

  function selectBlock(id: string, isMultiSelect: boolean = false): void {
    if (!isMultiSelect) {
      selectedIds.value.clear();
    }
    selectedIds.value.add(id);
  }

  function deselectBlock(id: string): void {
    selectedIds.value.delete(id);
  }

  function clearSelection(): void {
    selectedIds.value.clear();
  }

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id);
  }

  function clearRotation(): void {
    entries.value = [];
    selectedIds.value.clear();
  }

  return {
    entries,
    selectedIds,
    totalBlockCount,
    selectedEntries,
    instantiateBlock,
    addFreeformBlock,
    moveBlock,
    deleteBlock,
    deleteSelectedBlocks,
    selectBlock,
    deselectBlock,
    clearSelection,
    isSelected,
    clearRotation,
  };
});
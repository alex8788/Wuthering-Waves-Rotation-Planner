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
import { useHistory } from '../composables/useHistory';

/** 刪除消失動畫時長(ms)，須與 RotationBlock 的 @keyframes block-leave 一致。 */
const LEAVE_MS = 180;
/** 是否偏好減少動畫（reduce 時略過刪除動畫、直接移除）。 */
const _reducedMotion =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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

  /**
   * editingId / editingDraft：目前處於行內編輯的區塊 id 與其草稿文字。
   * 集中於 store 是為了讓 RotationBoard 的隱藏量測列能即時「看到」尚未提交的
   * 草稿文字，據以即時重算欄寬 → 編輯時區塊寬度隨輸入即時調整、鄰塊即時順延。
   * editingId 為 null 代表目前無區塊在編輯。
   */
  const editingId = ref<string | null>(null);
  const editingDraft = ref<string>('');

  /**
   * leavingIds：正在播放刪除消失動畫的區塊 id 集合。
   * 區塊仍留在 entries 中（佔欄位、可播動畫），動畫結束後才真正移除。
   */
  const leavingIds = ref<Set<string>>(new Set());

  // Undo/Redo 歷史：在每個會改動 entries 的 action 起手呼叫 history.record()
  // 先封存「變更前」狀態（同一同步批次只記一步，邏輯見 useHistory）。
  const history = useHistory();

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
   * @param forcedId - 指定要使用的 id（例如拖曳預覽階段已先產生好的 id，
   *   讓正式資料與預覽用的暫時物件共用同一個 id，維持 :key 穩定）；
   *   未提供時才內部重新產生一個新的 UUID
   */
  function instantiateBlock(
    sourceBlock: DefaultBlock | TemplateBlock,
    targetSlotIndex: SlotIndex,
    targetCharacterId: string,
    afterIndex: number = entries.value.length - 1,
    forcedId?: string
  ): void {
    history.record();
    const clonedData = deepClone(sourceBlock);

    const newBlock: Block = {
      ...clonedData,
      id: forcedId ?? generateUUID(), // 賦予全新的泛用識別碼
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
  ): string {
    history.record();
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

    // 回傳新區塊 id，供呼叫端（如新增後立即進入行內編輯）取得目標
    return newBlock.id;
  }

  /**
   * updateLabel：更新主時間軸上某區塊的顯示文字（行內編輯提交）。
   * 若 trim 後為空字串，視為「放棄此區塊」並直接刪除（對應新增空白區塊後未輸入即失焦）。
   */
  function updateLabel(id: string, label: string): void {
    history.record();
    const trimmed = label.trim();
    if (trimmed === '') {
      deleteBlock(id);
      return;
    }
    entries.value = entries.value.map((entry) =>
      entry.id === id
        ? { ...entry, block: { ...entry.block, label: trimmed } }
        : entry
    );
  }

  /**
   * insertClonedBlocks：將一組已複製的區塊（通常來自剪貼簿）插入到主時間軸。
   * 與 addFreeformBlock 不同，此方法會完整保留 originId 與 tags 的血統，
   * 並且為每個區塊重新賦予全新的 UUID，防止重複貼上造成 ID 衝突。
   *
   * @param clonedEntries - 要插入的區塊條目陣列（需為深拷貝後的資料）
   * @param startInsertAfterIndex - 插入的起始基準索引
   */
  function insertClonedBlocks(
    clonedEntries: RotationEntry[],
    startInsertAfterIndex: number
  ): string[] {
    history.record();
    let currentIndex = startInsertAfterIndex;
    let currentEntries = [...entries.value]; // 暫存目前的陣列，準備批次更新
    const newIds: string[] = []; // 回傳新插入區塊的 id（供貼上後捲動定位用）

    for (const entry of clonedEntries) {
      // 為了確保重複貼上時不會有 ID 衝突，每次插入都必須重新生成 UUID
      const newId = generateUUID();
      newIds.push(newId);
      const newEntry: RotationEntry = {
        ...entry,
        id: newId,
        block: {
          ...entry.block,
          id: newId,
        },
      };

      if (currentIndex >= currentEntries.length - 1) {
        currentEntries = appendEntry(currentEntries, newEntry);
      } else {
        currentEntries = insertEntryAfterIndex(currentEntries, newEntry, currentIndex);
      }
      currentIndex++; // 確保下一個區塊排在剛剛插入的區塊後面
    }

    entries.value = currentEntries; // 一次性更新響應式狀態，觸發畫面渲染
    return newIds;
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

    history.record();
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
   * moveBlocks：多選整組移動。把 ids 對應的區塊（依目前全域順序、相對順序不變）
   * 一起移到 toInsertAfterIndex 之後（語意同 moveBlock 的「含全部 entries」after-index）。
   * 行為近似「插隊解壓縮」：以鼠標錨點為插入點，被選中的區塊整批塞入，各自 slotIndex 不變。
   */
  function moveBlocks(ids: string[], toInsertAfterIndex: number): void {
    const idSet = new Set(ids);
    const ordered = entries.value.filter((entry) => idSet.has(entry.id)); // 保留相對順序
    if (ordered.length === 0) return;
    history.record();

    // 落點錨：從 toInsertAfterIndex 往前找第一個「不在選取集合」的區塊當基準
    // （落點若落在被拖群組內，往前退到群組外的最近區塊，插在它之後）。
    let anchorId: string | null = null;
    const startIdx = Math.min(toInsertAfterIndex, entries.value.length - 1);
    for (let i = startIdx; i >= 0; i--) {
      if (!idSet.has(entries.value[i].id)) {
        anchorId = entries.value[i].id;
        break;
      }
    }

    const remaining = entries.value.filter((entry) => !idSet.has(entry.id));
    const insertAt =
      anchorId === null ? 0 : remaining.findIndex((entry) => entry.id === anchorId) + 1;

    entries.value = [
      ...remaining.slice(0, insertAt),
      ...ordered,
      ...remaining.slice(insertAt),
    ];
  }

  /**
   * deleteBlock：從主時間軸刪除單一區塊。
   */
  function deleteBlock(id: string): void {
    history.record();
    entries.value = removeEntryById(entries.value, id);
    selectedIds.value.delete(id);
  }

  /**
   * startEditing：標記某區塊進入行內編輯，並以其目前 label 初始化草稿
   *（新增的空白區塊 label 為空字串）。
   */
  function startEditing(id: string): void {
    editingId.value = id;
    editingDraft.value = entries.value.find((e) => e.id === id)?.block.label ?? '';
  }

  /** setEditingDraft：同步行內編輯框的即時草稿文字（供量測列即時重算欄寬）。 */
  function setEditingDraft(text: string): void {
    editingDraft.value = text;
  }

  /** stopEditing：結束行內編輯，清掉草稿狀態。 */
  function stopEditing(): void {
    editingId.value = null;
    editingDraft.value = '';
  }

  /**
   * deleteSelectedBlocks：批量刪除目前所有被選中的區塊。
   * 先標記 leavingIds 播放消失動畫，LEAVE_MS 後才真正從 entries 移除
   *（reduce 動畫偏好或無選取時直接移除）。
   */
  function deleteSelectedBlocks(): void {
    const idsToDelete = [...selectedIds.value];
    if (idsToDelete.length === 0) return;
    history.record();
    // 立即清除選取，讓區塊在消失動畫期間呈現未選取樣式
    selectedIds.value.clear();

    if (_reducedMotion) {
      entries.value = removeEntriesByIds(entries.value, idsToDelete);
      return;
    }

    idsToDelete.forEach((id) => leavingIds.value.add(id));
    setTimeout(() => {
      entries.value = removeEntriesByIds(entries.value, idsToDelete);
      idsToDelete.forEach((id) => leavingIds.value.delete(id));
    }, LEAVE_MS);
  }

  /** isLeaving：該區塊是否正在播放刪除消失動畫。 */
  function isLeaving(id: string): boolean {
    return leavingIds.value.has(id);
  }

  function selectBlock(id: string, isMultiSelect: boolean = false): void {
    if (!isMultiSelect) {
      selectedIds.value.clear();
    }
    selectedIds.value.add(id);
  }

  /**
   * selectBlocks：批次選取一組區塊（marquee 框選用）。
   * additive=false 時先清空既有選取；true 則累加到目前選取上。
   */
  function selectBlocks(ids: string[], additive: boolean = false): void {
    if (!additive) selectedIds.value.clear();
    ids.forEach((id) => selectedIds.value.add(id));
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

  /**
   * clearSlot：清空某條泳道（slotIndex）的所有區塊，並一併移除其選取狀態。
   * 用於更換泳道角色時清掉舊角色殘留的區塊。
   */
  function clearSlot(slotIndex: SlotIndex): void {
    entries.value = entries.value.filter((entry) => {
      if (entry.slotIndex === slotIndex) {
        selectedIds.value.delete(entry.id);
        return false;
      }
      return true;
    });
  }

  return {
    entries,
    selectedIds,
    editingId,
    editingDraft,
    totalBlockCount,
    selectedEntries,
    startEditing,
    setEditingDraft,
    stopEditing,
    instantiateBlock,
    addFreeformBlock,
    updateLabel,
    insertClonedBlocks,
    moveBlock,
    moveBlocks,
    deleteBlock,
    deleteSelectedBlocks,
    isLeaving,
    selectBlock,
    selectBlocks,
    deselectBlock,
    clearSelection,
    isSelected,
    clearRotation,
    clearSlot,
  };
});
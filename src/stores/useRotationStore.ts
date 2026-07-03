// ============================================================
// useRotationStore.ts — 核心 Pinia Store：管理 1D 輸出軸陣列。
//
// 設計原則：
//   - 所有主時間軸的增刪改查集中於此。
//   - 對外暴露的 entries 是「作用中輸出軸 entries」的 writable computed
//     代理 → 既有時間軸操作在多軸下零改動即可運作。
//   - 每個會改 entries 的 action 起手呼叫 history.record()（同批次只記一步）。
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RotationArray, RotationEntry, RotationAxis } from '../types/rotation';
import type { Block, DefaultBlock, TemplateBlock } from '../types/block';
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
  // ── State ──────────────────────────────────

  /** 所有輸出軸（各持一條 entries）；初始一條空白軸。 */
  const axes = ref<RotationAxis[]>([
    { id: generateUUID(), name: '輸出軸 1', entries: [] },
  ]);

  /** 目前作用中的輸出軸 id。 */
  const activeAxisId = ref<string>(axes.value[0].id);

  /** 作用中輸出軸物件（找不到退回第一條，確保永不為空）。 */
  const activeAxis = computed<RotationAxis>(
    () => axes.value.find((a) => a.id === activeAxisId.value) ?? axes.value[0]
  );

  /** 核心 1D 陣列：作用中軸 entries 的 writable computed 代理。 */
  const entries = computed<RotationArray>({
    get: () => activeAxis.value.entries,
    set: (val) => {
      activeAxis.value.entries = val;
    },
  });

  /** 被選中的區塊 id 集合（Set，has 為 O(1)）。 */
  const selectedIds = ref<Set<string>>(new Set());

  // 行內編輯的區塊 id 與即時草稿：集中於 store，讓隱藏量測列即時讀草稿重算欄寬
  // → 編輯時區塊寬度隨輸入即時變、鄰塊順延。editingId 為 null＝無編輯中。
  const editingId = ref<string | null>(null);
  const editingDraft = ref<string>('');

  /** 正在播刪除消失動畫的 id 集合；仍留在 entries 佔欄位，動畫結束才真正移除。 */
  const leavingIds = ref<Set<string>>(new Set());

  const history = useHistory();

  // ── Computed ───────────────────────────────

  /** 主時間軸總區塊數。 */
  const totalBlockCount = computed(() => entries.value.length);

  /** 被選中的條目（維持 1D 陣列的相對時間順序）。 */
  const selectedEntries = computed(() =>
    entries.value.filter((e) => selectedIds.value.has(e.id))
  );

  // ── Actions ────────────────────────────────

  /**
   * 從側邊欄區塊建立 InstanceBlock 並加入時間軸。
   * forcedId：沿用拖曳預覽已產生的 id 使 :key 穩定；未給則新產生 UUID。
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

  /** 憑空新增空白/自訂文字的實體區塊（自由輸入，originId 設 null）；回傳新 id。 */
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

  /** 更新區塊文字（行內編輯提交）；trim 後為空則視為放棄並刪除該區塊。 */
  function updateLabel(id: string, label: string): void {
    const trimmed = label.trim();
    if (trimmed === '') {
      deleteBlock(id); // deleteBlock 自身會 record（pending 中則被抑制）
      return;
    }
    // 文字未變更：視為無操作，不記錄歷史（避免雙擊後原樣提交留下空步）。
    const current = entries.value.find((entry) => entry.id === id);
    if (current && current.block.label === trimmed) return;
    history.record();
    entries.value = entries.value.map((entry) =>
      entry.id === id
        ? { ...entry, block: { ...entry.block, label: trimmed } }
        : entry
    );
  }

  /**
   * 插入一組已複製的區塊（通常來自剪貼簿），保留 originId/tags 血統。
   * 每個區塊重新賦予新 UUID，防止重複貼上 ID 衝突；回傳新插入的 id 陣列。
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

  /** 主軸內移動單一區塊；允許跨泳道（一併更新 slotIndex 與 characterId）。 */
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
   * 多選整組移動：ids 對應區塊（保持相對順序）整批移到 toInsertAfterIndex 之後。
   * 各自 slotIndex 不變；落點若落在被拖群組內則往前退到群組外最近區塊之後。
   */
  function moveBlocks(ids: string[], toInsertAfterIndex: number): void {
    const idSet = new Set(ids);
    const ordered = entries.value.filter((entry) => idSet.has(entry.id)); // 保留相對順序
    if (ordered.length === 0) return;
    history.record();

    // 落點錨：從 toInsertAfterIndex 往前找第一個「不在選取集合」的區塊當基準。
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

  /** 刪除單一區塊。 */
  function deleteBlock(id: string): void {
    history.record();
    entries.value = removeEntryById(entries.value, id);
    selectedIds.value.delete(id);
  }

  /** 標記區塊進入行內編輯，以其目前 label 初始化草稿。 */
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

  /** 批量刪除選中區塊：先標記 leavingIds 播動畫，LEAVE_MS 後移除（reduce 則即刪）。 */
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
    if (isMultiSelect) {
      // Ctrl/Cmd + 點擊：切換該區塊——已選則取消（多選中拔掉單顆），未選則加入。
      if (selectedIds.value.has(id)) selectedIds.value.delete(id);
      else selectedIds.value.add(id);
      return;
    }
    // 一般點擊：若目前只選中這一顆 → 再點一次取消選取；否則清掉其他、只選這顆。
    const onlyThis = selectedIds.value.size === 1 && selectedIds.value.has(id);
    selectedIds.value.clear();
    if (!onlyThis) selectedIds.value.add(id);
  }

  /** 批次選取一組區塊（框選用）；additive=false 先清空、true 累加。 */
  function selectBlocks(ids: string[], additive: boolean = false): void {
    if (!additive) selectedIds.value.clear();
    ids.forEach((id) => selectedIds.value.add(id));
  }

  function clearSelection(): void {
    selectedIds.value.clear();
  }

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id);
  }

  /** 清空某泳道在「所有輸出軸」的區塊並移除其選取（換角色＝跨軸重開連招）。 */
  function clearSlot(slotIndex: SlotIndex): void {
    history.record();
    axes.value.forEach((axis) => {
      axis.entries = axis.entries.filter((entry) => {
        if (entry.slotIndex === slotIndex) {
          selectedIds.value.delete(entry.id);
          return false;
        }
        return true;
      });
    });
  }

  // ── 輸出軸（多分頁）管理 ────────────────────

  /** 新增空白輸出軸並切為作用中，回傳新軸 id（列入歷史）。 */
  function addAxis(name: string): string {
    history.record();
    const id = generateUUID();
    axes.value = [...axes.value, { id, name, entries: [] }];
    setActiveAxis(id);
    return id;
  }

  /** 刪除輸出軸；至少保留一條。刪到作用中軸則切到相鄰軸（列入歷史）。 */
  function deleteAxis(id: string): void {
    if (axes.value.length <= 1) return;
    const index = axes.value.findIndex((a) => a.id === id);
    if (index === -1) return;
    history.record();
    const wasActive = activeAxisId.value === id;
    axes.value = axes.value.filter((a) => a.id !== id);
    if (wasActive) {
      // 切到原位置的相鄰軸（優先後一條，否則前一條）。
      const next = axes.value[index] ?? axes.value[index - 1] ?? axes.value[0];
      setActiveAxis(next.id);
    }
  }

  /** 更名輸出軸；名稱去空白後為空或未變更時不記錄歷史。 */
  function renameAxis(id: string, name: string): void {
    const trimmed = name.trim();
    const target = axes.value.find((a) => a.id === id);
    if (!target || trimmed === '' || target.name === trimmed) return;
    history.record();
    axes.value = axes.value.map((a) =>
      a.id === id ? { ...a, name: trimmed } : a
    );
  }

  /** 切換作用中輸出軸（純檢視，不記歷史）；清掉選取與編輯態避免懸空參照。 */
  function setActiveAxis(id: string): void {
    if (!axes.value.some((a) => a.id === id)) return;
    activeAxisId.value = id;
    clearSelection();
    stopEditing();
  }

  return {
    axes,
    activeAxisId,
    activeAxis,
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
    clearSelection,
    isSelected,
    clearSlot,
    addAxis,
    deleteAxis,
    renameAxis,
    setActiveAxis,
  };
});
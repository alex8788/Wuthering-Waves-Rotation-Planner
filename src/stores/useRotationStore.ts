// ============================================================
// useRotationStore.ts
// 核心 Pinia Store：管理整個 1D 輸出軸陣列（RotationArray）。
//
// 這是本專案最重要的 store，所有對主時間軸的增刪改查都在這裡。
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RotationArray, RotationEntry, RotationAxis } from '../types/rotation';
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
   * axes：所有「輸出軸」(類似 Excel 工作表分頁),每個各自擁有一條 entries。
   * 初始僅一條空白輸出軸。隊伍/泳道順序/歷史跨軸共用(見 useHistory)。
   */
  const axes = ref<RotationAxis[]>([
    { id: generateUUID(), name: '輸出軸 1', entries: [] },
  ]);

  /** activeAxisId：目前作用中(畫面顯示)的輸出軸 id。 */
  const activeAxisId = ref<string>(axes.value[0].id);

  /** activeAxis：目前作用中的輸出軸物件(找不到時退回第一條,確保永不為空)。 */
  const activeAxis = computed<RotationAxis>(
    () => axes.value.find((a) => a.id === activeAxisId.value) ?? axes.value[0]
  );

  /**
   * entries：對外暴露的核心 1D 陣列 —— 實為「作用中輸出軸 entries」的 writable
   * computed 代理。讀寫都落到 activeAxis,使所有既有時間軸操作(及 RotationBoard
   * 的量測/分流、useBlockDrag)零改動即可在多軸下運作。
   */
  const entries = computed<RotationArray>({
    get: () => activeAxis.value.entries,
    set: (val) => {
      activeAxis.value.entries = val;
    },
  });

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
   * clearSlot：清空某條泳道（slotIndex）在「所有輸出軸」的區塊，並一併移除選取狀態。
   * 用於更換泳道角色時清掉舊角色殘留的區塊（換角色＝跨所有輸出軸重開連招）。
   */
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

  // ──────────────────────────────────────────
  // 輸出軸（多分頁）管理
  // ──────────────────────────────────────────

  /**
   * addAxis：新增一條空白輸出軸並切換為作用中，回傳新軸 id。
   * 列入歷史：undo 會移除此軸並聚焦回原本作用中的軸。
   */
  function addAxis(name: string): string {
    history.record();
    const id = generateUUID();
    axes.value = [...axes.value, { id, name, entries: [] }];
    setActiveAxis(id);
    return id;
  }

  /**
   * deleteAxis：刪除指定輸出軸；至少保留一條（僅剩一條時為 no-op）。
   * 刪到作用中軸時，作用中切換到相鄰軸。列入歷史（undo 可救回被刪的軸）。
   */
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

  /**
   * renameAxis：更名輸出軸；名稱去頭尾空白後為空或未變更時不記錄歷史。
   */
  function renameAxis(id: string, name: string): void {
    const trimmed = name.trim();
    const target = axes.value.find((a) => a.id === id);
    if (!target || trimmed === '' || target.name === trimmed) return;
    history.record();
    axes.value = axes.value.map((a) =>
      a.id === id ? { ...a, name: trimmed } : a
    );
  }

  /**
   * setActiveAxis：切換作用中輸出軸（純檢視切換，不記錄歷史）。
   * 切換時清掉選取與編輯態，避免懸空參照到另一條軸的區塊。
   */
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
    deselectBlock,
    clearSelection,
    isSelected,
    clearRotation,
    clearSlot,
    addAxis,
    deleteAxis,
    renameAxis,
    setActiveAxis,
  };
});
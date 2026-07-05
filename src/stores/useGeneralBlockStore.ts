// ============================================================
// useGeneralBlockStore.ts — 側邊欄「通用預設區塊」管理（可增刪改、持久化）。
//
// 定位：這些區塊為「通用（characterId: null）」基礎招式，不綁角色，可拖到任一泳道。
//   - 首次載入以 constants/generalBlocks 的 7 個內建區塊為「種子」寫入。
//   - 之後使用者可新增、命名（rename label）、選取、刪除；全程 LocalStorage 持久化。
//   - 顏色固定中性灰（不可改）；label 為唯一可編輯內容。
// 選取狀態（多選拖曳／批量刪除用）不持久化，比照 useTemplateStore 的模板選取。
// ============================================================

import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { GeneralBlock } from '@/types/block';
import { GENERAL_BLOCKS } from '@/constants/generalBlocks';
import { generateUUID } from '@/utils/uuid';
import { useSettings } from '@/composables/state/useSettings';

const STORAGE_KEY = 'wuwa-rotation-general-blocks';
/** 通用預設區塊的中性灰（系統預設、非角色專屬）。 */
export const GENERAL_BLOCK_COLOR = '#64748B';

/** 正規化為合法 GeneralBlock（防手改 localStorage：強制通用欄位、固定色）。 */
function normalize(b: Partial<GeneralBlock>): GeneralBlock {
  return {
    id: typeof b.id === 'string' && b.id ? b.id : generateUUID(),
    label: typeof b.label === 'string' ? b.label : '',
    color: GENERAL_BLOCK_COLOR,
    characterId: null,
    source: 'general',
    tags: [],
  };
}

/** 首次（無儲存鍵）以內建 7 個為種子；之後沿用使用者的內容（含清空）。 */
function loadFromStorage(): GeneralBlock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return GENERAL_BLOCKS.map((b) => normalize(b));
    const parsed = JSON.parse(raw) as Partial<GeneralBlock>[];
    return Array.isArray(parsed) ? parsed.map(normalize) : GENERAL_BLOCKS.map((b) => normalize(b));
  } catch (e) {
    console.warn('[useGeneralBlockStore] 讀取失敗，改用內建種子', e);
    return GENERAL_BLOCKS.map((b) => normalize(b));
  }
}

export const useGeneralBlockStore = defineStore('generalBlocks', () => {
  /** 通用預設區塊清單（種子 + 使用者自訂）；LocalStorage 初始化。 */
  const blocks = ref<GeneralBlock[]>(loadFromStorage());

  // 首次（無儲存鍵）立即寫入種子，讓儲存鍵永遠存在、行為確定（避免每次全新載入
  // 都走種子分支；使用者刪空後 [] 也會被保留）。之後的變更由下方 watch 持久化。
  if (localStorage.getItem(STORAGE_KEY) === null) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks.value));
    } catch (e) {
      console.warn('[useGeneralBlockStore] 種子寫入失敗', e);
    }
  }

  /** 選取的 id 集合（多選拖曳／批量刪除用）；不持久化。 */
  const selectedIds = ref<Set<string>>(new Set());

  // 變動自動持久化（deep watch 以捕捉 label 內部變更）。
  watch(
    blocks,
    (v) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
      } catch (e) {
        console.warn('[useGeneralBlockStore] 寫入失敗', e);
      }
    },
    { deep: true },
  );

  /** 新增一個空 label 的通用區塊，回傳其 id（呼叫端隨即進入命名）。 */
  function addBlock(): string {
    const block = normalize({});
    blocks.value = [...blocks.value, block];
    return block.id;
  }

  /** 更新 label；trim 後為空＝刪除該區塊（比照主軸新增後放棄命名）。
   *  大寫鎖定（設定）開啟時自動轉大寫（僅影響英文字母），與主軸行內編輯一致。 */
  function updateLabel(id: string, label: string): void {
    let trimmed = label.trim();
    if (useSettings().settings.value.autoUppercase) trimmed = trimmed.toUpperCase();
    if (trimmed === '') {
      deleteBlock(id);
      return;
    }
    blocks.value = blocks.value.map((b) => (b.id === id ? { ...b, label: trimmed } : b));
  }

  /** 刪除單一區塊。 */
  function deleteBlock(id: string): void {
    blocks.value = blocks.value.filter((b) => b.id !== id);
    selectedIds.value.delete(id);
  }

  /** 批量刪除目前選取的區塊，並清空選取。 */
  function deleteSelected(): void {
    if (selectedIds.value.size === 0) return;
    const ids = selectedIds.value;
    blocks.value = blocks.value.filter((b) => !ids.has(b.id));
    selectedIds.value = new Set();
  }

  /** 切換選取；additive=true（Ctrl/Cmd）累加，false 則單選（清其他，再點同一個＝取消）。 */
  function toggleSelection(id: string, additive: boolean): void {
    if (!additive) {
      const onlyThis = selectedIds.value.size === 1 && selectedIds.value.has(id);
      selectedIds.value.clear();
      if (!onlyThis) selectedIds.value.add(id);
      return;
    }
    if (selectedIds.value.has(id)) selectedIds.value.delete(id);
    else selectedIds.value.add(id);
  }

  function clearSelection(): void {
    selectedIds.value.clear();
  }

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id);
  }

  return {
    blocks,
    selectedIds,
    addBlock,
    updateLabel,
    deleteBlock,
    deleteSelected,
    toggleSelection,
    clearSelection,
    isSelected,
  };
});

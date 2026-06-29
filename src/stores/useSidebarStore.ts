// ============================================================
// useSidebarStore.ts
// Pinia Store：管理側邊欄的自訂模板區塊。
//
// 功能：
//  1. 儲存各角色的自訂模板（TemplateBlock[]）
//  2. 序列化（從主軸拖回側邊欄時新增模板）
//  3. 刪除模板
//  4. LocalStorage 持久化（確保重新整理不遺失資料）
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { TemplateBlock, InstanceBlock } from '../types/block';
import { DEFAULT_BLOCKS } from '../constants/defaultBlocks';
import { generateUUID } from '../utils/uuid';
import { deepClone } from '../utils/deepClone';
import { showToast as showGlobalToast, type ToastVariant } from '../composables/useToast';

/** LocalStorage 儲存鍵名 */
const STORAGE_KEY = 'wuwa-rotation-templates';

/**
 * 從 LocalStorage 讀取已存的模板資料。
 * 若讀取失敗（資料損壞或 key 不存在），回傳空陣列。
 *
 * @returns TemplateBlock[] 或空陣列
 */
function loadTemplatesFromStorage(): TemplateBlock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    // JSON.parse 可能拋出 SyntaxError，使用 try-catch 防護
    return JSON.parse(raw) as TemplateBlock[];
  } catch (e) {
    console.warn('[useSidebarStore] LocalStorage 資料讀取失敗，使用空模板庫', e);
    return [];
  }
}

export const useSidebarStore = defineStore('sidebar', () => {
  // ──────────────────────────────────────────
  // State
  // ──────────────────────────────────────────

  /**
   * templates：所有角色的自訂模板，在同一個陣列中儲存（以 characterId 區分歸屬）。
   * 從 LocalStorage 初始化，確保頁面重整後資料不遺失。
   */
  const templates = ref<TemplateBlock[]>(loadTemplatesFromStorage());

  /**
   * selectedTemplateIds：目前在模板庫被選取的模板 id 集合（Ctrl/Cmd 多選用）。
   * 用於批量刪除；選取狀態不持久化，重整即清空。
   */
  const selectedTemplateIds = ref<Set<string>>(new Set());

  // ──────────────────────────────────────────
  // LocalStorage 自動同步
  // ──────────────────────────────────────────

  /**
   * 監聽 templates 的變化，自動同步至 LocalStorage。
   * 使用 deep watch 確保陣列內部物件的屬性變更也能觸發。
   */
  watch(
    templates,
    (newTemplates) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newTemplates));
      } catch (e) {
        console.warn('[useSidebarStore] LocalStorage 寫入失敗', e);
      }
    },
    { deep: true }
  );

  // ──────────────────────────────────────────
  // Computed
  // ──────────────────────────────────────────

  /**
   * defaultBlocks：系統預設的基礎招式區塊。
   */
  const defaultBlocks = computed(() => DEFAULT_BLOCKS);

  /**
   * getTemplatesByCharacter：依角色 ID 篩選對應的自訂模板。
   * 依 label 字元數遞增排序（短的在前）；區塊寬度由字元數自動撐開，故等同寬度遞增，
   * 且不需量測 DOM。字數相同時以建立時間（舊→新）為次序，維持穩定排列。
   */
  const getTemplatesByCharacter = computed(
    () => (characterId: string) =>
      templates.value
        .filter((t) => t.characterId === characterId)
        .sort((a, b) => a.label.length - b.label.length || a.createdAt - b.createdAt)
  );

  // ──────────────────────────────────────────
  // Actions
  // ──────────────────────────────────────────

  /**
   * serializeToTemplate：將主軸上的 InstanceBlock 序列化為模板，加入側邊欄。
   * 內部委派 serializeManyToTemplates 處理（單顆＝長度 1 的批量），確保去重與
   * toast 行為與多選拖回完全一致。
   *
   * @param instance - 主軸上要序列化的 InstanceBlock
   */
  function serializeToTemplate(instance: InstanceBlock): void {
    serializeManyToTemplates([instance]);
  }

  /**
   * serializeManyToTemplates：批量將主軸 InstanceBlock 序列化為模板（主軸多選拖回）。
   *
   * 自動擋下既有元素：略過「同角色＋同 label（trim 後相同）」已存在於模板庫者，
   * 並一併對「本批內重複」去重（同一拖曳不會把同一個塊加兩次）。
   * 最後依新增/略過數量發「一則」彙總 toast（單顆時沿用原本的單句訊息）。
   *
   * @param instances - 要序列化的 InstanceBlock 陣列（通常為主軸選取集合）
   */
  function serializeManyToTemplates(instances: InstanceBlock[]): void {
    // 既有模板 + 本批已加入者，統一以 `characterId|label` 為去重鍵
    const seen = new Set(templates.value.map((t) => `${t.characterId}|${t.label.trim()}`));
    const newTemplates: TemplateBlock[] = [];
    let skipped = 0;

    for (const instance of instances) {
      // 主軸實體一定綁角色；防禦性跳過無角色者（理論上不會發生）
      if (!instance.characterId) {
        skipped++;
        continue;
      }
      const cloned = deepClone(instance);
      const label = cloned.label.trim();
      const key = `${cloned.characterId}|${label}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      // 精確組裝 TemplateBlock，不將 instance 專屬的 originId 屬性帶入
      newTemplates.push({
        id: generateUUID(),
        label: cloned.label,
        color: cloned.color,
        source: 'template',
        characterId: cloned.characterId,
        tags: cloned.tags,
        createdAt: Date.now(),
      });
    }

    const added = newTemplates.length;
    if (added > 0) {
      // 一次性接上，watch 只觸發一次持久化
      templates.value = [...templates.value, ...newTemplates];
    }

    // ── 依情況發一則彙總 toast ──────────────────────────────
    if (added === 0) {
      // 全數已存在（或無有效塊）
      showToast(skipped === 1 ? '模板庫已有相同區塊' : '選取區塊皆已存在於模板庫', 'warning');
    } else if (skipped === 0) {
      showToast(added === 1 ? '已新增至模板庫' : `已新增 ${added} 個區塊至模板庫`, 'success');
    } else {
      showToast(`已新增 ${added} 個區塊至模板庫，${skipped} 個區塊已存在`, 'success');
    }
  }

  /**
   * deleteTemplate：從側邊欄刪除指定的自訂模板。
   *
   * @param id - 要刪除的 TemplateBlock.id
   */
  function deleteTemplate(id: string): void {
    templates.value = templates.value.filter((t) => t.id !== id);
    selectedTemplateIds.value.delete(id);
  }

  /**
   * toggleTemplateSelection：切換模板的選取狀態。
   * @param id - 目標模板 id
   * @param additive - true（Ctrl/Cmd）時累加切換；false 時改為單選（清掉其他）
   */
  function toggleTemplateSelection(id: string, additive: boolean): void {
    if (!additive) {
      const onlyThis = selectedTemplateIds.value.size === 1 && selectedTemplateIds.value.has(id);
      selectedTemplateIds.value.clear();
      if (!onlyThis) selectedTemplateIds.value.add(id);
      return;
    }
    if (selectedTemplateIds.value.has(id)) {
      selectedTemplateIds.value.delete(id);
    } else {
      selectedTemplateIds.value.add(id);
    }
  }

  /** clearTemplateSelection：清除所有模板選取。 */
  function clearTemplateSelection(): void {
    selectedTemplateIds.value.clear();
  }

  /** isTemplateSelected：該模板是否被選取。 */
  function isTemplateSelected(id: string): boolean {
    return selectedTemplateIds.value.has(id);
  }

  /** deleteSelectedTemplates：批量刪除目前選取的模板，並清空選取。 */
  function deleteSelectedTemplates(): void {
    if (selectedTemplateIds.value.size === 0) return;
    const ids = selectedTemplateIds.value;
    templates.value = templates.value.filter((t) => !ids.has(t.id));
    selectedTemplateIds.value = new Set();
  }

  /**
   * showToast：顯示右下角的提示框。
   * 轉呼叫全域 useToast 單例（ToastNotification 唯一實際訂閱的來源）。
   */
  function showToast(message: string, variant: ToastVariant = 'info'): void {
    showGlobalToast(message, variant);
  }

  return {
    templates,
    selectedTemplateIds,
    defaultBlocks,
    getTemplatesByCharacter,
    serializeToTemplate,
    serializeManyToTemplates,
    deleteTemplate,
    toggleTemplateSelection,
    clearTemplateSelection,
    isTemplateSelected,
    deleteSelectedTemplates,
    showToast,
  };
});
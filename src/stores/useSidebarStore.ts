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
   *
   * @param instance - 主軸上要序列化的 InstanceBlock
   * @returns 建立完成的 TemplateBlock；若同角色已有相同 label 的模板則不新增，回傳 null
   */
  function serializeToTemplate(instance: InstanceBlock): TemplateBlock | null {
    // 確保 characterId 不為 null（自訂模板一定要綁定角色）
    if (!instance.characterId) {
      throw new Error('[useSidebarStore.serializeToTemplate] 區塊的 characterId 不可為 null');
    }

    // 深拷貝，避免主軸上的資料與模板庫共用參考
    const clonedBlock = deepClone(instance);

    // 去重：同角色內若已存在相同 label（trim 後完全相同）的模板，不重複新增，僅提示。
    const label = clonedBlock.label.trim();
    const isDuplicate = templates.value.some(
      (t) => t.characterId === clonedBlock.characterId && t.label.trim() === label
    );
    if (isDuplicate) {
      showToast('模板庫已有相同區塊', 'warning');
      return null;
    }

    // 精確組裝 TemplateBlock，不將 instance 專屬的 originId 屬性帶入
    const newTemplate: TemplateBlock = {
      id: generateUUID(), // 統一使用泛用 id
      label: clonedBlock.label,
      color: clonedBlock.color,
      source: 'template',
      characterId: clonedBlock.characterId,
      tags: clonedBlock.tags,
      createdAt: Date.now(),
    };

    // 推入模板陣列（watch 會自動持久化）
    templates.value.push(newTemplate);

    // 觸發 Toast 提示
    showToast('已新增至模板庫', 'success');

    return newTemplate;
  }

  /**
   * deleteTemplate：從側邊欄刪除指定的自訂模板。
   *
   * @param id - 要刪除的 TemplateBlock.id
   */
  function deleteTemplate(id: string): void {
    templates.value = templates.value.filter((t) => t.id !== id);
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
    defaultBlocks,
    getTemplatesByCharacter,
    serializeToTemplate,
    deleteTemplate,
    showToast,
  };
});
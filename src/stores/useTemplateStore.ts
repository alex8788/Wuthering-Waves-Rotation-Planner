// ============================================================
// useTemplateStore.ts — 側邊欄「自訂模板」區塊管理。
//
// 側邊欄內容分兩類：通用區塊（見 useGeneralBlockStore）與此處的「自訂模板」
// （綁角色、由主軸拖回序列化而來）。本 store 專責後者。
// 職責：儲存各角色模板、主軸拖回時序列化為模板、刪除、LocalStorage 持久化。
// ============================================================

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { TemplateBlock, InstanceBlock } from '../types/block';
import { generateUUID } from '../utils/uuid';
import { deepClone } from '../utils/deepClone';
import { showToast } from '@/composables/state/useToast';
import { t } from '@/i18n';
import { useSettings } from '@/composables/state/useSettings';
import { isPersistenceSuspended } from '@/composables/state/persistenceGuard';

/** LocalStorage 儲存鍵名 */
const STORAGE_KEY = 'wuwa-rotation-templates';

/** 從 LocalStorage 讀模板；不存在或損壞時回空陣列。 */
function loadTemplatesFromStorage(): TemplateBlock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TemplateBlock[];
  } catch (e) {
    console.warn('[useTemplateStore] LocalStorage 資料讀取失敗，使用空模板庫', e);
    return [];
  }
}

export const useTemplateStore = defineStore('templates', () => {
  /** 所有角色的自訂模板（以 characterId 區分歸屬）；從 LocalStorage 初始化。 */
  const templates = ref<TemplateBlock[]>(loadTemplatesFromStorage());

  /** 模板庫選取的 id 集合（Ctrl/Cmd 多選、批量刪除用）；不持久化。 */
  const selectedTemplateIds = ref<Set<string>>(new Set());

  // templates 變動自動同步 LocalStorage（deep watch 以捕捉物件內部變更）。
  watch(
    templates,
    (newTemplates) => {
      if (isPersistenceSuspended()) return; // 導覽示範期間不落地（見 persistenceGuard）
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newTemplates));
      } catch (e) {
        console.warn('[useTemplateStore] LocalStorage 寫入失敗', e);
      }
    },
    { deep: true }
  );

  // 依角色 id 篩模板，並依 label 字元數遞增排序（＝寬度遞增，免量 DOM）；
  // 字數相同時以建立時間為次序，維持穩定排列。
  // 命名中的新模板（label 為空）一律排到最後，使其停在「＋」鈕旁的原地、
  // 不被排序插到最前（比照通用區塊新增不重排的行為）；命名完成後才正常歸位。
  const getTemplatesByCharacter = computed(
    () => (characterId: string) =>
      templates.value
        .filter((t) => t.characterId === characterId)
        .sort((a, b) => {
          const aEmpty = a.label.trim() === '';
          const bEmpty = b.label.trim() === '';
          if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
          return a.label.length - b.label.length || a.createdAt - b.createdAt;
        })
  );

  /**
   * 批量把主軸 InstanceBlock 序列化為模板（主軸拖回；單顆亦走此路徑）。
   * 以 `characterId|label` 去重（略過模板庫已有者與本批重複），最後發一則彙總 toast。
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
      showToast(skipped === 1 ? t('toast.templateExists') : t('toast.templatesAllExist'), 'warning');
    } else if (skipped === 0) {
      showToast(added === 1 ? t('toast.templateAdded') : t('toast.templatesAdded', { n: added }), 'success');
    } else {
      showToast(t('toast.templatesAddedSkipped', { added, skipped }), 'success');
    }
  }

  /** 新增一個空 label 的自訂模板（側邊欄 ＋ 鈕），回傳其 id（呼叫端隨即進入命名）。 */
  function addTemplate(characterId: string, color: string): string {
    const id = generateUUID();
    templates.value = [
      ...templates.value,
      { id, label: '', color, source: 'template', characterId, tags: [], createdAt: Date.now() },
    ];
    return id;
  }

  /** 更新模板 label；trim 後為空＝刪除（比照通用區塊放棄命名）。
   *  大寫鎖定（設定）開啟時自動轉大寫。同角色下 label 重複時不寫入：
   *  發 toast 警告，若原本就是未命名的新模板則直接移除，否則保留原名。 */
  function updateTemplateLabel(id: string, label: string): void {
    const target = templates.value.find((tpl) => tpl.id === id);
    if (!target) return;
    let trimmed = label.trim();
    if (useSettings().settings.value.autoUppercase) trimmed = trimmed.toUpperCase();
    if (trimmed === '') {
      deleteTemplate(id);
      return;
    }
    const duplicated = templates.value.some(
      (tpl) => tpl.id !== id && tpl.characterId === target.characterId && tpl.label.trim() === trimmed
    );
    if (duplicated) {
      showToast(t('toast.templateExists'), 'warning');
      if (target.label.trim() === '') deleteTemplate(id);
      return;
    }
    templates.value = templates.value.map((tpl) => (tpl.id === id ? { ...tpl, label: trimmed } : tpl));
  }

  /** 刪除指定自訂模板。 */
  function deleteTemplate(id: string): void {
    templates.value = templates.value.filter((t) => t.id !== id);
    selectedTemplateIds.value.delete(id);
  }

  /** 切換模板選取；additive=true（Ctrl/Cmd）累加切換，false 則單選（清掉其他）。 */
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

  /** clearAllTemplates：清空整個自訂模板庫（設定選單「清除資料」用）；回傳清除筆數。 */
  function clearAllTemplates(): number {
    const count = templates.value.length;
    templates.value = [];
    selectedTemplateIds.value = new Set();
    return count;
  }

  /** deleteSelectedTemplates：批量刪除目前選取的模板，並清空選取。 */
  function deleteSelectedTemplates(): void {
    if (selectedTemplateIds.value.size === 0) return;
    const ids = selectedTemplateIds.value;
    templates.value = templates.value.filter((t) => !ids.has(t.id));
    selectedTemplateIds.value = new Set();
  }

  return {
    templates,
    selectedTemplateIds,
    getTemplatesByCharacter,
    serializeManyToTemplates,
    addTemplate,
    updateTemplateLabel,
    deleteTemplate,
    clearAllTemplates,
    toggleTemplateSelection,
    clearTemplateSelection,
    isTemplateSelected,
    deleteSelectedTemplates,
  };
});
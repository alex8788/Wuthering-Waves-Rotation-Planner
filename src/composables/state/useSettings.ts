// ============================================================
// useSettings.ts — 全域使用者設定（module 單例，LocalStorage 持久化）。
//
// 設定項：
//   - language      ：介面語言（目前僅繁中；切換器為佔位，值先持久化備用）。
//   - autoUppercase ：大寫鎖定 — 區塊文字行內編輯提交時自動轉大寫
//                     （只影響英文字母，中文不受影響）。
//
// 「清除資料」不屬設定值，由 SettingsMenu 直接呼叫對應 store 的清除動作。
// ============================================================

import { ref, watch } from 'vue';

const STORAGE_KEY = 'wuwa-rotation-settings';

export interface AppSettings {
  /** 介面語言（佔位）：'zh-TW' | 未來擴充。 */
  language: string;
  /** 大寫鎖定：區塊文字提交時自動轉大寫。 */
  autoUppercase: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-TW',
  autoUppercase: false,
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    // 與預設合併：未來新增設定項時，舊存檔缺的欄位自動補預設值。
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch (e) {
    console.warn('[useSettings] 設定讀取失敗，使用預設值', e);
    return { ...DEFAULT_SETTINGS };
  }
}

// 模組層級單例：整個 App 共用同一份設定。
const settings = ref<AppSettings>(loadSettings());

watch(
  settings,
  (next) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('[useSettings] 設定寫入失敗', e);
    }
  },
  { deep: true },
);

export function useSettings() {
  return { settings };
}

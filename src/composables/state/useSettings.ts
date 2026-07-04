// ============================================================
// useSettings.ts — 全域使用者設定（module 單例，LocalStorage 持久化）。
//
// 設定項：
//   - language          ：介面語言（目前僅繁中；切換器為佔位，值先持久化備用）。
//   - autoUppercase     ：大寫鎖定 — 區塊文字提交時自動轉大寫（僅英文字母）。
//   - animationsEnabled ：動畫效果總開關；關閉＝強制減少動態（等同 reduced-motion）。
//   - historyLimit      ：復原/重做步數上限（夾在 HISTORY_LIMIT_BOUNDS）。
//   - trackGapPx        ：主軸區塊間距（px，夾在 TRACK_GAP_BOUNDS）。
//   - rememberExport    ：記住匯出設定；開啟時匯出視窗每次調整即存 localStorage。
//   - exportPrefs       ：記住的匯出偏好（檔名 / 合併模式）。
//
// 「清除資料」不屬設定值，由 SettingsMenu 直接呼叫對應 store 的清除動作。
// ============================================================

import { ref, watch } from 'vue';
import { TRACK_GAP_PX } from '@/constants/layout';
import type { ExportMode } from '@/composables/state/useExportDialog';

const STORAGE_KEY = 'wuwa-rotation-settings';

/** 復原步數的上下限（UI number input 與載入時皆夾在此範圍）。 */
export const HISTORY_LIMIT_BOUNDS = { min: 5, max: 100 } as const;
/** 區塊間距（px）的上下限。 */
export const TRACK_GAP_BOUNDS = { min: 0, max: 16 } as const;

export interface ExportPrefs {
  filename: string;
  mode: ExportMode;
}

export interface AppSettings {
  /** 介面語言（佔位）：'zh-TW' | 未來擴充。 */
  language: string;
  /** 大寫鎖定：區塊文字提交時自動轉大寫。 */
  autoUppercase: boolean;
  /** 動畫效果總開關；false＝強制減少動態。 */
  animationsEnabled: boolean;
  /** 復原/重做步數上限。 */
  historyLimit: number;
  /** 主軸區塊間距（px）。 */
  trackGapPx: number;
  /** 記住匯出設定（每次調整即持久化）。 */
  rememberExport: boolean;
  /** 記住的匯出偏好。 */
  exportPrefs: ExportPrefs;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-TW',
  autoUppercase: false,
  animationsEnabled: true,
  historyLimit: 30,
  trackGapPx: TRACK_GAP_PX,
  rememberExport: false,
  exportPrefs: { filename: '', mode: 'merge' },
};

/** 夾住數值於 [min, max]（NaN 回退預設）。 */
export function clampSetting(value: number, bounds: { min: number; max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // 與預設合併：舊存檔缺的欄位自動補預設值；巢狀 exportPrefs 亦逐欄補齊。
    const parsed = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      exportPrefs: { ...DEFAULT_SETTINGS.exportPrefs, ...(parsed.exportPrefs ?? {}) },
    };
    // 數值型設定載入時亦夾範圍（防手改 localStorage 造成異常值）。
    merged.historyLimit = clampSetting(merged.historyLimit, HISTORY_LIMIT_BOUNDS, DEFAULT_SETTINGS.historyLimit);
    merged.trackGapPx = clampSetting(merged.trackGapPx, TRACK_GAP_BOUNDS, DEFAULT_SETTINGS.trackGapPx);
    return merged;
  } catch (e) {
    console.warn('[useSettings] 設定讀取失敗，使用預設值', e);
    return { ...DEFAULT_SETTINGS, exportPrefs: { ...DEFAULT_SETTINGS.exportPrefs } };
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

// 動畫總開關 → 於 <html> 掛 force-reduce-motion class（CSS 全域關閉動畫，
// 見 style.css）；JS 端由 reducedMotion.ts 讀本設定。immediate 使載入即生效。
if (typeof document !== 'undefined') {
  watch(
    () => settings.value.animationsEnabled,
    (on) => {
      document.documentElement.classList.toggle('force-reduce-motion', !on);
    },
    { immediate: true },
  );
}

export function useSettings() {
  return { settings };
}

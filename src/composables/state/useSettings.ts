// ============================================================
// useSettings.ts — 全域使用者設定（module 單例，LocalStorage 持久化）。
//
// 設定項：
//   - language          ：介面語言（zh-CN / zh-TW / en / ja / ko，見 i18n/index.ts）。
//   - autoUppercase     ：大寫鎖定 — 區塊文字提交時自動轉大寫（僅英文字母）。
//   - animationsEnabled ：動畫效果總開關；關閉＝強制減少動態（等同 reduced-motion）。
//   - hotkeyTapCombine  ：熱鍵模式快速連點合併 — 時間窗內的連續 tap 串接成單一區塊。
//   - historyLimit      ：復原/重做步數上限（夾在 HISTORY_LIMIT_BOUNDS）。
//   - trackGapPx        ：主軸區塊間距（px，夾在 TRACK_GAP_BOUNDS）。
//   - rememberExport    ：記住匯出設定；開啟時匯出視窗每次調整即存 localStorage。
//   - exportPrefs       ：記住的匯出偏好（檔名 / 合併模式）。
//
// 「清除資料」不屬設定值，由 SettingsMenu 直接呼叫對應 store 的清除動作。
// ============================================================

import { ref, watch } from 'vue';
import { TRACK_GAP_PX } from '@/constants/layout';
import type { ExportMode, ExportFormat } from '@/composables/state/useExportDialog';
import { DEFAULT_PIXEL_RATIO } from '@/composables/useImageExport';

const STORAGE_KEY = 'wuwa-rotation-settings';

/** 復原步數的上下限（UI number input 與載入時皆夾在此範圍）。 */
export const HISTORY_LIMIT_BOUNDS = { min: 5, max: 100 } as const;
/** 區塊間距（px）的上下限。 */
export const TRACK_GAP_BOUNDS = { min: 0, max: 16 } as const;
/** 區塊文字左右邊距（px）的上下限。 */
export const CHIP_PADDING_BOUNDS = { min: 4, max: 32 } as const;
/** 區塊文字左右邊距預設值（px），= BlockChip 的 1rem 基準。 */
export const DEFAULT_CHIP_PADDING_PX = 16;
/** 區塊文字大小（px）的上下限。 */
export const CHIP_FONT_SIZE_BOUNDS = { min: 12, max: 24 } as const;
/** 區塊文字大小預設值（px），= BlockChip label 的 1rem 基準（compact 按比例縮）。 */
export const DEFAULT_CHIP_FONT_SIZE_PX = 16;

/**
 * 介面等寬字型選項。stack 注入 <html> 的 --app-font-mono，全站等寬字型
 * （標題列/區塊標籤/對話框等）統一引用。Google Fonts 已於 index.html 預載
 * 全部候選家族（@font-face 惰性下載：未用到的字型檔不會抓）。
 * 寬度計算不受影響：FLIP/落點/合計寬皆量實際 DOM（getBoundingClientRect）。
 */
export const FONT_OPTIONS = [
  { value: 'jetbrains-mono', label: 'JetBrains Mono', stack: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" },
  { value: 'fira-code', label: 'Fira Code', stack: "'Fira Code', 'JetBrains Mono', ui-monospace, monospace" },
  { value: 'ibm-plex-mono', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, monospace" },
  { value: 'source-code-pro', label: 'Source Code Pro', stack: "'Source Code Pro', ui-monospace, monospace" },
  { value: 'roboto-mono', label: 'Roboto Mono', stack: "'Roboto Mono', ui-monospace, monospace" },
  { value: 'system-mono', label: '', stack: "ui-monospace, Consolas, 'SFMono-Regular', Menlo, monospace" },
] as const;
export type FontOptionValue = (typeof FONT_OPTIONS)[number]['value'];
const DEFAULT_FONT: FontOptionValue = 'jetbrains-mono';

interface ExportPrefs {
  filename: string;
  mode: ExportMode;
  format: ExportFormat;
  scale: number;
}

interface AppSettings {
  /** 介面語言代碼（對應 i18n SUPPORTED_LOCALES）。 */
  language: string;
  /** 大寫鎖定：區塊文字提交時自動轉大寫。 */
  autoUppercase: boolean;
  /** 動畫效果總開關；false＝強制減少動態。 */
  animationsEnabled: boolean;
  /** 熱鍵模式快速連點合併（時間窗見 useHotkeyInputMode 的 TAP_COMBINE_WINDOW_MS）。 */
  hotkeyTapCombine: boolean;
  /** 復原/重做步數上限。 */
  historyLimit: number;
  /** 主軸區塊間距（px）。 */
  trackGapPx: number;
  /** 區塊文字左右邊距（px），影響區塊寬度。 */
  chipPaddingPx: number;
  /** 區塊文字大小（px），影響區塊寬度。 */
  chipFontSizePx: number;
  /** 介面等寬字型（FONT_OPTIONS 之一）。 */
  appFont: FontOptionValue;
  /** 記住匯出設定（每次調整即持久化）。 */
  rememberExport: boolean;
  /** 記住的匯出偏好。 */
  exportPrefs: ExportPrefs;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  autoUppercase: false,
  animationsEnabled: true,
  hotkeyTapCombine: false,
  historyLimit: 30,
  trackGapPx: TRACK_GAP_PX,
  chipPaddingPx: DEFAULT_CHIP_PADDING_PX,
  chipFontSizePx: DEFAULT_CHIP_FONT_SIZE_PX,
  appFont: DEFAULT_FONT,
  rememberExport: false,
  exportPrefs: { filename: '', mode: 'merge', format: 'png', scale: DEFAULT_PIXEL_RATIO },
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
    merged.chipPaddingPx = clampSetting(merged.chipPaddingPx, CHIP_PADDING_BOUNDS, DEFAULT_SETTINGS.chipPaddingPx);
    merged.chipFontSizePx = clampSetting(merged.chipFontSizePx, CHIP_FONT_SIZE_BOUNDS, DEFAULT_SETTINGS.chipFontSizePx);
    // 字型代碼驗證：未知值（如舊版存檔或手改）回退預設。
    if (!FONT_OPTIONS.some((f) => f.value === merged.appFont)) merged.appFont = DEFAULT_FONT;
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

  // 區塊文字左右邊距 → 於 <html> 注入 --chip-px-setting CSS 變數，
  // BlockChip / RotationBlock 輸入框 / style.css 拖曳分身規則統一引用，
  // 主軸、側邊欄、匯出視圖一次生效。immediate 使載入即生效。
  watch(
    () => settings.value.chipPaddingPx,
    (px) => {
      document.documentElement.style.setProperty('--chip-px-setting', `${px}px`);
    },
    { immediate: true },
  );

  // 區塊文字大小 → 於 <html> 注入 --chip-fs-setting CSS 變數，
  // BlockChip label / RotationBlock 輸入框 / style.css 拖曳分身規則統一引用
  //（compact 版按固定比例縮小）。immediate 使載入即生效。
  watch(
    () => settings.value.chipFontSizePx,
    (px) => {
      document.documentElement.style.setProperty('--chip-fs-setting', `${px}px`);
    },
    { immediate: true },
  );

  // 介面字型 → 於 <html> 注入 --app-font-mono CSS 變數，全站等寬字型
  // 宣告統一引用（var(--app-font-mono, ...)）。immediate 使載入即生效。
  watch(
    () => settings.value.appFont,
    (code) => {
      const opt = FONT_OPTIONS.find((f) => f.value === code) ?? FONT_OPTIONS[0];
      document.documentElement.style.setProperty('--app-font-mono', opt.stack);
    },
    { immediate: true },
  );
}

/**
 * 還原匯出相關設定至預設（「清除資料」用）：記住匯出開關與匯出偏好。
 * 其餘設定（語言/大寫/動畫/步數/間距）保留不動。
 */
export function resetExportSettings(): void {
  settings.value.rememberExport = DEFAULT_SETTINGS.rememberExport;
  settings.value.exportPrefs = { ...DEFAULT_SETTINGS.exportPrefs };
}

export function useSettings() {
  return { settings };
}

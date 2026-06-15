import type { Config } from 'tailwindcss';

// ============================================================
// tailwind.config.ts
// 設計語言定義。
//
// 【設計決策】
// 工具型應用採深色主題，視覺上呼應遊戲 UI 風格。
// 三條泳道各有獨立的角色主題色，但主色盤保持克制：
//   - 背景層次：void（最深）→ panel → lane（最淺但仍深）
//   - 高亮色：cyan（chrome），用於選取框線、拖曳指示線、互動反饋
//   - 區塊顏色：完全動態（來自 block.color），Tailwind 不管理
// ============================================================
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // ── 色彩系統 ──────────────────────────────────────────
      colors: {
        // 背景層次
        'void':      '#0A0A0F', // 最外層主背景
        'panel':     '#13131E', // 側邊欄、浮層面板
        'lane':      '#0D0D18', // 泳道背景
        'surface':   '#1C1C2E', // 區塊預設底色（被 block.color 覆蓋）
        // 互動高亮
        'chrome':    '#22D3EE', // cyan-400，UI chrome 主色
        'chrome-dim':'#0891B2', // cyan-600，次要 chrome
        // 狀態色
        'danger':    '#EF4444', // 紅色，刪除警告條紋
      },
      // ── 邊框透明度 ────────────────────────────────────────
      borderColor: {
        'subtle': 'rgba(255, 255, 255, 0.08)',
        'faint':  'rgba(255, 255, 255, 0.04)',
      },
      // ── 字型 ──────────────────────────────────────────────
      fontFamily: {
        // index.html 透過 Google Fonts CDN 載入
        sans: ['"Noto Sans TC"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      // ── 動畫 Keyframes ────────────────────────────────────
      keyframes: {
        // 區塊拖起（放大 + 陰影加深）
        'block-lift': {
          '0%':   { transform: 'scale(1)',    boxShadow: '0 2px 6px rgba(0,0,0,0.5)' },
          '100%': { transform: 'scale(1.06)', boxShadow: '0 10px 32px rgba(0,0,0,0.75)' },
        },
        // 區塊落下（帶微小彈性的 Spring Bounce）
        'snap-in': {
          '0%':   { transform: 'scale(1.06)' },
          '55%':  { transform: 'scale(0.97)' },
          '80%':  { transform: 'scale(1.01)' },
          '100%': { transform: 'scale(1)' },
        },
        // 側邊欄新增模板後的閃爍
        'flash': {
          '0%, 100%': { opacity: '1' },
          '40%':      { opacity: '0.25' },
        },
        // Toast 滑入
        'toast-enter': {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Toast 滑出
        'toast-leave': {
          '0%':   { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(12px)' },
        },
        // 選取框線淡入
        'select-ring': {
          '0%':   { boxShadow: '0 0 0 0px rgba(34, 211, 238, 0.4)' },
          '100%': { boxShadow: '0 0 0 2px rgba(34, 211, 238, 0.85)' },
        },
        // 落點吸附線的脈衝光效
        'indicator-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scaleY(1)' },
          '50%':      { opacity: '0.6', transform: 'scaleY(1.3)' },
        },
      },
      animation: {
        'block-lift':       'block-lift 0.12s ease-out forwards',
        'snap-in':          'snap-in 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'flash':            'flash 0.5s ease-in-out 2',
        'toast-enter':      'toast-enter 0.2s ease-out forwards',
        'toast-leave':      'toast-leave 0.18s ease-in forwards',
        'select-ring':      'select-ring 0.15s ease-out forwards',
        'indicator-pulse':  'indicator-pulse 0.9s ease-in-out infinite',
      },
      // ── 過渡時間 ──────────────────────────────────────────
      transitionDuration: {
        '80': '80ms',
      },
    },
  },
  plugins: [],
} satisfies Config;
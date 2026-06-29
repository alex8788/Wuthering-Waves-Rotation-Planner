<script setup lang="ts">
// ============================================================
// BlockChip.vue
// 時間軸區塊的「純視覺無狀態元件」。
// 所有互動狀態（isHovered、isSelected、isDanger）
// 皆由父層注入，元件本身不持有任何響應式資料。
// ============================================================

interface Props {
  /** 顯示文字，例如 'A'、'3AE'、'EQ' */
  label: string
  /** 背景顏色 hex 字串，例如 '#22D3EE' */
  color: string
  /** true 時顯示青色微光邊框（游標懸停提示） */
  isHovered?: boolean
  /** true 時顯示較強的青色光暈（多選狀態） */
  isSelected?: boolean
  /** true 時疊加紅色斜條紋警告動畫（即將丟棄提示） */
  isDanger?: boolean
  /** true 時用較小尺寸（側邊欄預設/模板庫，相對主軸略縮小） */
  compact?: boolean
}

withDefaults(defineProps<Props>(), {
  isHovered: false,
  isSelected: false,
  isDanger: false,
  compact: false,
})
</script>

<template>
  <div
    class="block-chip"
    :class="{
      'block-chip--hovered': isHovered && !isSelected && !isDanger,
      'block-chip--selected': isSelected && !isDanger,
      'block-chip--danger': isDanger,
      'block-chip--compact': compact,
    }"
    :style="{ '--chip-bg': color }"
    role="presentation"
  >
    <!-- 基底色層 -->
    <div class="block-chip__bg" />

    <!-- 危險斜紋遮罩層（isDanger 時才渲染以節省 GPU） -->
    <div v-if="isDanger" class="block-chip__danger-overlay" aria-hidden="true" />

    <!-- 文字層（永遠在最上層） -->
    <span class="block-chip__label">{{ label }}</span>
  </div>
</template>

<style scoped>
/* ── CSS 自訂屬性（由 :style 注入） ─────────────────────── */
.block-chip {
  --chip-bg: #22D3EE;            /* 由 Props color 覆寫 */
  --chip-height: 3rem;           /* 48px 固定高度（主軸；側邊欄 compact 為 44px） */
  --chip-px: 1rem;               /* 左右內距 */
  --chip-radius: 3px;
  --cyan: #22D3EE;
  --danger-red: #EF4444;
  --danger-red-dark: #DC2626;

  /* ── 佈局 ─── */
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--chip-height);
  padding: 0 var(--chip-px);
  border-radius: var(--chip-radius);
  white-space: nowrap;
  overflow: hidden;
  cursor: grab;
  user-select: none;

  /* ── 邊框：預設透明，狀態時變色 ─── */
  border: 1.5px solid transparent;

  /* ── 過渡（border、shadow、transform 三軸） ─── */
  transition:
    border-color 0.15s ease,
    box-shadow   0.15s ease,
    transform    0.12s ease;
}

/* ── 基底色層 ─────────────────────────────────────────────── */
.block-chip__bg {
  position: absolute;
  inset: 0;
  background-color: var(--chip-bg);
  /* 底部微暗漸層，模擬面板厚度感 */
  background-image: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.08) 0%,
    rgba(0, 0, 0, 0.18) 100%
  );
}

/* ── 文字層 ────────────────────────────────────────────────── */
.block-chip__label {
  position: relative;
  z-index: 2;
  /* 中文字型補在 monospace 之後：monospace 無 CJK glyph 時改用真粗體的黑體，
     避免 fallback 字型在高字重下假粗(faux-bold)使筆畫糊成一團。 */
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', ui-monospace,
    'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif;
  font-size: 1rem;       /* 16px：主軸（側邊欄 compact 為 15px） */
  font-weight: 700;      /* 粗體；700 有真字模，中文不會假粗擠筆畫 */
  letter-spacing: 0.05em;
  /* 維持霓虹白風格，靠描邊與背景分離 → 淺色塊不刺眼、深色塊不低對比。
     微米白(0.95)削掉純白 glare；描邊加粗到 0.7px 讓最亮的氣動(#55FFB5)也讀得清；
     paint-order 讓描邊在字下方使字緣乾淨不糊。 */
  color: rgba(255, 255, 255, 0.95);
  -webkit-text-stroke: 0.7px rgba(8, 12, 24, 0.65);
  paint-order: stroke fill;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

/* ── 尺寸：精簡（compact）──────────────────────────────────────
   側邊欄預設/模板庫用，相對主軸略縮小。覆蓋 --chip-height/--chip-px
   與 label 字級（規則置於基底之後，等特異性下後者勝出）。 */
.block-chip--compact {
  --chip-height: 2.75rem;   /* 44px（主軸為 52px） */
  --chip-px: 0.875rem;
}
.block-chip--compact .block-chip__label {
  font-size: 0.9375rem;     /* 15px（主軸為 17px） */
}

/* ── 狀態：懸停（isHovered）────────────────────────────────── */
.block-chip--hovered {
  border-color: rgba(34, 211, 238, 0.45);
  box-shadow:
    0 0  6px rgba(34, 211, 238, 0.15),
    inset 0 0 4px rgba(34, 211, 238, 0.06);
}

/* ── 狀態：選中（isSelected）───────────────────────────────── */
.block-chip--selected {
  border-color: rgba(34, 211, 238, 0.85);
  box-shadow:
    0 0 10px rgba(34, 211, 238, 0.30),
    0 0  3px rgba(34, 211, 238, 0.50),
    inset 0 0  8px rgba(34, 211, 238, 0.10);
}

/* ── 狀態：危險（isDanger）─────────────────────────────────── */
/* 邊框轉紅 */
.block-chip--danger {
  border-color: rgba(239, 68, 68, 0.70);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.25);
}

/* 斜紋遮罩層 */
.block-chip__danger-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  background-image: repeating-linear-gradient(
    -45deg,
    rgba(239, 68, 68, 0.72)   0px,
    rgba(239, 68, 68, 0.72)   5px,
    rgba(185, 28,  28, 0.30)  5px,
    rgba(185, 28,  28, 0.30) 11px
  );
  /* n8：tile 寫死為條紋週期的正方形(11√2)，與區塊寬度脫鉤，接縫永遠連續無斷層。
     預設 background-size:auto 會讓 tile＝區塊寬度，寬度非週期整數倍時接縫斷層。 */
  background-size: 15.5563px 15.5563px;
  background-repeat: repeat;
  /* 條紋流動動畫 */
  animation: danger-march 1s linear infinite;
}

@keyframes danger-march {
  from { background-position: 0 0; }
  /* 11px×√2 ≈ 15.5563px：移動一整個 tile，且 x、y 同步移動讓條紋垂直自身方向
     絲滑流動（只移單軸會變橫向滑且視覺怪）。tile 已與寬度脫鉤，故無斷層。
     方向須 x、y 同號（-45deg 漸層的「/」條紋，垂直方向＝右下）；反號會沿條紋
     自身方向移動而看起來靜止。 */
  to   { background-position: 15.5563px 15.5563px; }
}

/* isDanger 時強化文字對比（條紋背景下仍可讀） */
.block-chip--danger .block-chip__label {
  color: #ffffff;
  text-shadow:
    0 0 6px rgba(0, 0, 0, 0.80),
    0 1px 3px rgba(0, 0, 0, 0.60);
}

/* ── 無障礙：減少動畫模式 ──────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .block-chip {
    transition: none;
  }
  .block-chip__danger-overlay {
    animation: none;
    /* 靜態條紋仍保留視覺警示 */
  }
}
</style>

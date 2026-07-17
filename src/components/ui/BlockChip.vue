<script setup lang="ts">
// ============================================================
// BlockChip.vue
// 時間軸區塊的「純視覺無狀態元件」。
// 所有互動狀態（isHovered、isSelected 等）皆由父層注入，
// 元件本身不持有任何響應式資料。
// 拖曳刪除的紅紋警告不在此處：由 useBlockDrag 掛 <body> class、
// style.css 直接套在 SortableJS 浮動分身上（forceFallback 分身拿不到響應式 prop）。
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
  /** true 時文字反白（多選同步編輯時，批次成員鏡射輸入框的全選狀態） */
  isLabelHighlighted?: boolean
  /** true 時選取邊框調暗（多選同步編輯時，批次成員比照輸入框的淡青邊框） */
  isEditingDimmed?: boolean
  /** true 時用較小尺寸（側邊欄預設/模板庫，相對主軸略縮小） */
  compact?: boolean
}

withDefaults(defineProps<Props>(), {
  isHovered: false,
  isSelected: false,
  isLabelHighlighted: false,
  isEditingDimmed: false,
  compact: false,
})
</script>

<template>
  <div
    class="block-chip"
    :class="{
      'block-chip--hovered': isHovered && !isSelected,
      'block-chip--selected': isSelected && !isEditingDimmed,
      'block-chip--editing-dim': isEditingDimmed,
      'block-chip--compact': compact,
    }"
    :style="{ '--chip-bg': color }"
    role="presentation"
  >
    <!-- 基底色層 -->
    <div class="block-chip__bg" />

    <!-- 文字層（永遠在最上層） -->
    <span
      class="block-chip__label"
      :class="{ 'block-chip__label--highlighted': isLabelHighlighted }"
      >{{ label }}</span
    >
  </div>
</template>

<style scoped>
/* ── CSS 自訂屬性（由 :style 注入） ─────────────────────── */
.block-chip {
  --chip-bg: #22D3EE;            /* 由 Props color 覆寫 */
  --chip-height: 3rem;           /* 48px 固定高度（主軸；側邊欄 compact 為 44px） */
  --chip-px: var(--chip-px-setting, 1rem); /* 左右內距（可由設定調整，注入於 <html>） */
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

  /* ── 邊框：預設透明，狀態時變色（2px 全狀態共用，切換不位移） ─── */
  border: 2px solid transparent;

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
     微米白(0.95)削掉純白 glare；描邊加粗到 1px 並加深(0.78)，讓最亮的氣動
     (#55FFB5)、繞射等亮色塊也框得住白字；paint-order 讓描邊在字下方使字緣乾淨不糊。
     投影採雙層：第一層 0 0 1px 貼邊硬陰影＝在亮底鑲一圈緊實暗緣使字緣跳出；
     第二層 0 1px 3px 柔光暈＝深底下維持原本的厚度浮起感。 */
  color: #ffffff;
  -webkit-text-stroke: 1px rgba(8, 12, 24, 0.78);
  paint-order: stroke fill;
  text-shadow:
    0 0 1px rgba(8, 12, 24, 0.85),
    0 1px 3px rgba(0, 0, 0, 0.45);
}

/* ── 狀態：文字反白（isLabelHighlighted）──────────────────────
   多選同步編輯時，批次成員鏡射輸入框的「全選文字」視覺，提示這些字
   會被一起取代。與 RotationBlock 輸入框的 ::selection 同款：實心海軍藍底
   + 白字。海軍藍在任何底色（含淺色屬性塊：氣動綠、衍射黃、凝夜青）上都
   與白字保持高對比、清楚跳出；不再加青色外環（去掉圈狀邊框）。 */
.block-chip__label--highlighted {
  /* 與最左塊輸入框的原生 ::selection 對齊：緊貼文字的方角矩形，
     不加 border-radius/box-shadow 外擴，否則批次成員會比最左塊多一圈圓角。 */
  background-color: #00217d;
}

/* ── 尺寸：精簡（compact）──────────────────────────────────────
   側邊欄預設/模板庫用，相對主軸略縮小。覆蓋 --chip-height/--chip-px
   與 label 字級（規則置於基底之後，等特異性下後者勝出）。 */
.block-chip--compact {
  --chip-height: 2.75rem;   /* 44px（主軸為 52px） */
  /* 側邊欄同步跟隨設定值，按 0.875 比例縮小（原 0.875rem/1rem 之比），
     使拖出主軸前後的寬度感一致。 */
  --chip-px: calc(var(--chip-px-setting, 1rem) * 0.875);
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

/* ── 狀態：選中（isSelected）─────────────────────────────────
   邊框用全亮青色，外圈再疊一道深色分隔環，使選取框在亮色屬性塊
   （如氣動 #55FFB5、衍射等）上也清楚跳出；外層雙重光暈加強醒目度。 */
.block-chip--selected {
  border-color: #67E8F9;
  box-shadow:
    0 0 0 1px rgba(8, 12, 24, 0.65),
    0 0 16px rgba(34, 211, 238, 0.55),
    0 0  5px rgba(34, 211, 238, 0.80),
    inset 0 0 10px rgba(34, 211, 238, 0.18);
}

/* ── 狀態：編輯態邊框調暗（isEditingDimmed）─────────────────────
   多選同步編輯時，最左塊化為輸入框（本身即為淡青調暗邊框），其餘批次成員
   仍是 chip；此狀態讓這些成員的選取邊框比照輸入框調暗，使整批選取在編輯期間
   一致（不再只有最左塊變暗、其他仍是亮青光暈）。淡青、低不透明度＋柔光暈，
   與 RotationBlock__input 的 border/box-shadow 對齊。 */
.block-chip--editing-dim {
  border-color: rgba(125, 211, 252, 0.85);
  box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.2);
}

/* ── 無障礙：減少動畫模式 ──────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .block-chip {
    transition: none;
  }
}
</style>

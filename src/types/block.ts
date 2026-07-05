// ============================================================
// block.ts — 區塊（Block）資料型別。
//
// 設計原則：
//   - 區塊為純文字＋視覺呈現，不綁定招式語意。
//   - 三種來源以 source 字面量區分：default（內建、不可刪）/
//     template（側邊欄自訂）/ instance（主軸實體）。
//   - 主軸陣列只存 InstanceBlock；AnyBlock 為需跨來源時的聯合型別。
// ============================================================

/** 區塊來源：通用（側邊欄可自訂） / 側邊欄模板 / 主軸實體。 */
export type BlockSource = 'general' | 'template' | 'instance';

/** 區塊背景色，hex 字串（如 '#7C3AED'）。 */
export type BlockColor = string;

/** 所有區塊共用的基礎欄位。 */
export interface BlockBase {
  /** 顯示文字（如 'A'、'3AE' 或使用者自由輸入）。 */
  label: string;
  /** 背景顏色 hex。 */
  color: BlockColor;
  /** 所屬角色 id（對應 Character.id）；null 為不綁角色的通用區塊。 */
  characterId: string | null;
  /** 預留：Buff 狀態標記與 Tooltip。 */
  tags: string[];
}

/** 通用區塊（側邊欄可自訂：增刪改；不綁角色，可拖到任一泳道）。 */
export interface GeneralBlock extends BlockBase {
  id: string;
  source: 'general';
  characterId: null;
}

/** 側邊欄自訂模板區塊（必綁某一角色）。 */
export interface TemplateBlock extends BlockBase {
  id: string;
  source: 'template';
  characterId: string;
  /** 建立時間戳，供側邊欄排序。 */
  createdAt: number;
}

/** 主軸實體區塊（拖入的模板或直接新增皆屬此類）。 */
export interface InstanceBlock extends BlockBase {
  id: string;
  source: 'instance';
  characterId: string;
  /** 來源模板/預設區塊 id；主軸直接新增則為 null。 */
  originId: string | null;
}

/** 主軸 1D 陣列的元素型別。 */
export type Block = InstanceBlock;

/** 跨所有來源的區塊聯合型別（供通用渲染函式）。 */
export type AnyBlock = GeneralBlock | TemplateBlock | InstanceBlock;

// ============================================================
// character.ts — 角色（Character）與三個角色槽的型別。
//
// 設計原則：
//   - Character 同時用於「角色名單常數」與「已選角色槽」。
//   - 顯示顏色一律由 element 經 getElementColor 決定，資料本身不存色。
//   - 三條泳道對應 SlotIndex 0/1/2，以 tuple 固定長度為 3。
// ============================================================

/** 一個鳴潮角色的基本資料。 */
export interface Character {
  /** 唯一識別碼，英文名 kebab-case（如 'rover-havoc'）；對應 Block.characterId。 */
  id: string;
  /** 繁中顯示名稱。 */
  nameZh: string;
  /** 英文顯示名稱（選填；由 encore API en 版帶入，MVP 尚未使用於 UI）。 */
  nameEn?: string;
  /** 屬性（元素）。 */
  element: CharacterElement;
  /** 星級：5 或 4；角色選單各屬性頁籤內依此分組（5★ 在 4★ 之前）。 */
  rarity: CharacterRarity;
  /** 頭像本地路徑（選填），如 '/assets/characters/jiyan.webp'；爬蟲下載自存後填入。 */
  avatar?: string;
}

/** 角色星級。 */
export type CharacterRarity = 5 | 4;

/** 鳴潮六屬性。 */
export type CharacterElement =
  | '氣動'
  | '冷凝'
  | '導電'
  | '湮滅'
  | '衍射'
  | '熱熔';

/** 角色槽索引：三條泳道對應 0/1/2。 */
export type SlotIndex = 0 | 1 | 2;

/** 單一角色槽狀態；character 為 null 代表未選角。 */
export interface CharacterSlot {
  slotIndex: SlotIndex;
  character: Character | null;
}

/** 三個角色槽的完整狀態（tuple 固定長度 3）。 */
export type CharacterSlots = [CharacterSlot, CharacterSlot, CharacterSlot];

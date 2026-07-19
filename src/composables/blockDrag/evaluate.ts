// ============================================================
// blockDrag/evaluate.ts — 落點區域判定的純函式層。
//
// 由拖曳目標元素與來源資訊算出「游標所在區域 + 是否可畫落點預覽 + 預覽歸屬
// 泳道」,不觸碰任何狀態或 DOM class;副作用(dragState 寫入、body class、
// 遲滯清除、resolveAfterIndex)全由 useBlockDrag 的 _evaluateDropTarget 套用。
// 拆出純函式使區域判定邏輯可獨立測試(各區域優先序、角色匹配驗證)。
// ============================================================

import type { SlotIndex } from '@/types/character';
import {
  DROP_ZONE_ATTRIBUTE,
  DELETE_ZONE_ATTRIBUTE,
  SIDEBAR_ZONE_ATTRIBUTE,
  NEUTRAL_ZONE_ATTRIBUTE,
} from '@/composables/blockDrag/state';

/** 游標所在區域(互斥,依優先序判定)。 */
export type DropZone =
  /** 主軸區塊懸停於側邊欄序列化區 → 「拖回存成模板」落點(僅主軸來源)。 */
  | 'sidebar'
  /** 合法落點(泳道軌道內)。 */
  | 'valid'
  /** 中立區(泳道尾端留白佔位)= 禁止放置(彈回)。 */
  | 'neutral'
  /** 可刪除區(主軸面板內非軌道處)。 */
  | 'delete'
  /** 其餘一律禁止。 */
  | 'forbidden';

export interface DropEvaluation {
  zone: DropZone;
  /** zone === 'valid' 時是否可畫落點預覽;側邊欄來源須通過泳道/角色驗證。 */
  canPreview: boolean;
  /** 預覽歸屬泳道(canPreview 時必非 null)。 */
  previewSlotIndex: SlotIndex | null;
}

/** 讀取泳道 DOM 上的 data-slot-index。 */
export function readSlotIndex(lane: Element): SlotIndex | null {
  const raw = lane.getAttribute('data-slot-index');
  if (raw === null) return null;
  const n = Number(raw);
  return n === 0 || n === 1 || n === 2 ? (n as SlotIndex) : null;
}

export interface EvaluateDropParams {
  /** 游標下的真實元素(可能為 null,如落在 document/window 上)。 */
  target: Element | null;
  /** 拖曳來源是否為主軸區塊(rotation-instance)。 */
  isRotationSource: boolean;
  /** 主軸來源的歸屬泳道(側邊欄來源為 null)。 */
  draggingSlotIndex: SlotIndex | null;
  /** 側邊欄來源的原始區塊(characterId 用於角色匹配驗證)。 */
  sourceBlock: { characterId: string | null } | null;
  /** 查詢泳道目前綁定的角色 id(無角色 = null)。 */
  getCharacterIdBySlot: (slot: SlotIndex) => string | null;
}

export function evaluateDropTarget(params: EvaluateDropParams): DropEvaluation {
  const { target, isRotationSource, draggingSlotIndex, sourceBlock, getCharacterIdBySlot } = params;

  // ── 側邊欄序列化區優先:只對主軸來源生效(側邊欄來源拖回側邊欄無意義,維持禁止)──
  if (isRotationSource && !!target?.closest(`[${SIDEBAR_ZONE_ATTRIBUTE}]`)) {
    return { zone: 'sidebar', canPreview: false, previewSlotIndex: null };
  }

  const lane = target?.closest(`[${DROP_ZONE_ATTRIBUTE}]`) ?? null;
  if (!lane) {
    // 中立區(泳道尾端留白佔位)優先於刪除區:它位於主軸面板(刪除區)內,
    // 若不先排除會被 closest 誤判為可刪除 → 拖到留白鬆手誤刪。
    if (target?.closest(`[${NEUTRAL_ZONE_ATTRIBUTE}]`)) {
      return { zone: 'neutral', canPreview: false, previewSlotIndex: null };
    }
    if (target?.closest(`[${DELETE_ZONE_ATTRIBUTE}]`)) {
      return { zone: 'delete', canPreview: false, previewSlotIndex: null };
    }
    return { zone: 'forbidden', canPreview: false, previewSlotIndex: null };
  }

  if (isRotationSource) {
    // 主軸來源:歸屬泳道不變、全域位置可任意(不分泳道行);虛框畫在自己泳道。
    return { zone: 'valid', canPreview: true, previewSlotIndex: draggingSlotIndex };
  }

  // 側邊欄來源:歸屬泳道 = 游標所在泳道,需通過泳道解析與角色匹配驗證。
  const slotIndex = readSlotIndex(lane);
  if (slotIndex === null) {
    return { zone: 'valid', canPreview: false, previewSlotIndex: null };
  }
  const charId = getCharacterIdBySlot(slotIndex);
  if (!charId || (sourceBlock && sourceBlock.characterId !== null && sourceBlock.characterId !== charId)) {
    return { zone: 'valid', canPreview: false, previewSlotIndex: null };
  }
  return { zone: 'valid', canPreview: true, previewSlotIndex: slotIndex };
}

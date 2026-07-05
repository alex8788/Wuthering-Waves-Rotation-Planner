// ============================================================
// blockDrag/commit.ts — 拖曳落地編排：依快照執行 store 寫入（重構 R4）。
//
// 單一職責：拿「鬆手瞬間的拖曳快照」決定寫入哪個 store action
// （移動/刪除/序列化/實例化）。不碰 DOM、不管理拖曳狀態。
// ============================================================

import { useRotationStore } from '@/stores/useRotationStore';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import type { GeneralBlock, TemplateBlock } from '@/types/block';
import type { DragSourceType } from '@/types/rotation';
import type { SlotIndex } from '@/types/character';

/** 鬆手瞬間的拖曳快照（handleDragEnd 於 setTimeout 前擷取；之後狀態已被重置）。 */
export interface DropSnapshot {
  sourceType: DragSourceType | null;
  draggingId: string | null;
  draggingIds: string[];
  sourceBlock: GeneralBlock | TemplateBlock | null;
  sourceBlocks: (GeneralBlock | TemplateBlock)[];
  isOverSidebar: boolean;
  isOverDeleteZone: boolean;
  /** 含全部 entries 的全域 after-index；null = 無合法落點。 */
  afterIn: number | null;
  previewSlot: SlotIndex | null;
  pendingId: string | undefined;
}

/** 依快照把拖曳結果落地到 store（移動/刪除/序列化/實例化）。 */
export function commitDrop(snap: DropSnapshot): void {
  const rotationStore = useRotationStore();
  const templateStore = useTemplateStore();
  const characterStore = useCharacterStore();
  const {
    sourceType, draggingId, draggingIds, sourceBlock, sourceBlocks,
    isOverSidebar, isOverDeleteZone, afterIn, previewSlot, pendingId,
  } = snap;

  if (sourceType === 'rotation-instance' && draggingId) {
    const isMulti = draggingIds.length > 1;
    if (isOverSidebar) {
      // 拖回模板庫：多選整組一起序列化（批量去重＋彙總 toast），單顆亦走同路徑。
      const ids = isMulti ? draggingIds : [draggingId];
      const blocks = ids
        .map((id) => rotationStore.entries.find((e) => e.id === id)?.block)
        .filter((b): b is NonNullable<typeof b> => !!b);
      if (blocks.length) templateStore.serializeManyToTemplates(blocks);
    } else if (afterIn !== null) {
      // 全域重排：afterIn 已是「含全部」語意。多選整組以鼠標錨點插入、相對順序不變。
      if (isMulti) rotationStore.moveBlocks(draggingIds, afterIn);
      else rotationStore.moveBlock(draggingId, afterIn);
    } else if (isOverDeleteZone) {
      // 無合法落點且在可刪除區 → 刪除（多選刪整組）；禁止放置區一律彈回不刪
      if (isMulti) draggingIds.forEach((id) => rotationStore.deleteBlock(id));
      else rotationStore.deleteBlock(draggingId);
    }
    return;
  }

  if (sourceBlock && afterIn !== null && previewSlot !== null) {
    // 側邊欄來源落入泳道：再次角色校驗（雙重防線），用 previewSlot 決定歸屬泳道。
    const targetCharacterId = characterStore.getCharacterIdBySlot(previewSlot);
    if (!targetCharacterId) return;

    if (sourceBlocks.length > 1) {
      // 模板庫多選拖入：依「選取先後順序」由左而右解壓縮，逐一插在落點之後。
      // 跨泳道：每個模板依自己的 characterId 自動分流到對應泳道（非過濾），
      //   行為對齊主軸跨泳道多選。各塊用全新 id（不共用 pendingId）。
      // characterId 為 null（通用）的模板落入游標所在的目標泳道。
      let insertAt = afterIn;
      for (const b of sourceBlocks) {
        const slot =
          b.characterId === null
            ? previewSlot
            : characterStore.getSlotByCharacterId(b.characterId);
        if (slot === null) continue; // 該角色目前不在任何泳道 → 略過
        const charId = characterStore.getCharacterIdBySlot(slot);
        if (!charId) continue;
        rotationStore.instantiateBlock(b, slot, charId, insertAt);
        insertAt++;
      }
      templateStore.clearTemplateSelection();
    } else if (
      sourceBlock.characterId === null ||
      sourceBlock.characterId === targetCharacterId
    ) {
      rotationStore.instantiateBlock(sourceBlock, previewSlot, targetCharacterId, afterIn, pendingId);
    }
  }
}

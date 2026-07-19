// ============================================================
// useBlockDrag.ts — 全域拖曳協調門面（module 單例，重構 R4 後）。
//
// 三塊職責已拆分（單一職責）：
//   - blockDrag/state.ts    ：拖曳狀態單例＋區域標記常數＋重置。
//   - blockDrag/resolver.ts ：落點解析（hit-test 幾何、鄰居中心遲滯）。
//   - blockDrag/commit.ts   ：落地編排（依鬆手快照寫入 store）。
// 本檔保留「事件接線」：mousemove 懸停評估（三區判定＋body class）、
// 起拖/鬆手入口、SortableJS 選項。設計原則不變：
//   - SortableJS 僅負責「偵測拖曳 + 浮動分身視覺」；落點/落地全自製，
//     不依賴其 @add/@update index（跨全域排序時不可靠）。
//   - forceFallback：可見的是靜態浮動克隆 → 警告樣式用 <body> class + CSS。
// ============================================================

import { readonly, type DeepReadonly } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { generateUUID } from '@/utils/uuid';
import type { GeneralBlock, TemplateBlock } from '@/types/block';
import type { RotationEntry } from '@/types/rotation';
import type { SlotIndex } from '@/types/character';
import {
  dragStateInternal as _dragState,
  resetDragState,
  DROP_ZONE_ATTRIBUTE,
  DELETE_ZONE_ATTRIBUTE,
  SIDEBAR_ZONE_ATTRIBUTE,
  NEUTRAL_ZONE_ATTRIBUTE,
  DELETE_ZONE_BODY_CLASS,
  FORBIDDEN_BODY_CLASS,
  SIDEBAR_ZONE_BODY_CLASS,
  type DragState,
  type SortableEventLike,
} from '@/composables/blockDrag/state';
import { resolveAfterIndex, clearHysteresis } from '@/composables/blockDrag/resolver';
import { evaluateDropTarget } from '@/composables/blockDrag/evaluate';
import { commitDrop } from '@/composables/blockDrag/commit';
import { prefersReducedMotion } from '@/utils/reducedMotion';

// 呼叫端沿用本模組的匯出（Swimlane/RotationBoard/SidebarPanel 等），原樣轉出。
export { DROP_ZONE_ATTRIBUTE, DELETE_ZONE_ATTRIBUTE, SIDEBAR_ZONE_ATTRIBUTE, NEUTRAL_ZONE_ATTRIBUTE };
export type { SortableEventLike };

// 拖曳中最後一次游標座標（視窗座標）。供 notifyAutoScroll 在「游標靜止、內容自動捲動」時，
// 用同一座標重新評估落點（拿不到新的 mousemove event 時的座標來源）。
let _lastClientX = 0;
let _lastClientY = 0;

function _handleDragOver(event: MouseEvent): void {
  if (!_dragState.isDragging) return;
  _lastClientX = event.clientX;
  _lastClientY = event.clientY;
  // 游標可能落在 document/window 等非 Element 目標上（無 closest 方法），需防護。
  const target = event.target instanceof Element ? event.target : null;
  _evaluateDropTarget(event.clientX, event.clientY, target);
}

// 落點與區域評估：座標與目標全由參數帶入（不讀 event），供 mousemove
// （_handleDragOver）與自動捲動（notifyAutoScroll）共用。
// 區域判定本體在 blockDrag/evaluate.ts 的純函式；此處只把判定結果套用成
// 副作用（dragState 寫入、body class、遲滯清除、resolveAfterIndex）。
function _evaluateDropTarget(clientX: number, _clientY: number, target: Element | null): void {
  const isRotationSource = _dragState.sourceType === 'rotation-instance';
  const evaluation = evaluateDropTarget({
    target,
    isRotationSource,
    draggingSlotIndex: _dragState.draggingSlotIndex,
    sourceBlock: _dragState.draggingSourceBlock,
    getCharacterIdBySlot: (slot) => useCharacterStore().getCharacterIdBySlot(slot),
  });
  const { zone } = evaluation;

  // ── 側邊欄序列化區 → 「拖回存成模板」落點（4.4d）──
  // 獨立分支：不畫禁止/刪除、不算主軸排序落點，僅標記 isOverSidebar 供 handleDragEnd
  // 走 serializeManyToTemplates。
  _dragState.isOverSidebar = zone === 'sidebar';
  if (zone === 'sidebar') {
    _dragState.isOverInvalidZone = true;
    _dragState.isOverDeleteZone = false;
    _dragState.previewInsertAfterIndex = null;
    _dragState.previewSlotIndex = null;
    clearHysteresis();
    document.body.classList.remove(DELETE_ZONE_BODY_CLASS);
    document.body.classList.remove(FORBIDDEN_BODY_CLASS);
    document.body.classList.add(SIDEBAR_ZONE_BODY_CLASS);
    return;
  }
  document.body.classList.remove(SIDEBAR_ZONE_BODY_CLASS);

  const overValid = zone === 'valid';
  const overDeleteZone = zone === 'delete';
  _dragState.isOverInvalidZone = !overValid;
  _dragState.isOverDeleteZone = overDeleteZone;

  // 主軸區塊在可刪除區 → 紅紋；其餘非合法落點 → 禁止圖標（含側邊欄區塊在可刪除區）
  document.body.classList.toggle(DELETE_ZONE_BODY_CLASS, isRotationSource && overDeleteZone);
  document.body.classList.toggle(
    FORBIDDEN_BODY_CLASS,
    zone === 'neutral' || zone === 'forbidden' || (!isRotationSource && overDeleteZone),
  );

  if (!overValid) {
    _dragState.previewInsertAfterIndex = null;
    _dragState.previewSlotIndex = null;
    clearHysteresis(); // 離開合法落點 → 清遲滯，再入時重新即時定位
    return;
  }

  // ── 自製落點預覽：算出全域 after-index（single thread 跨泳道同步擠出）──
  // 側邊欄來源無法在 @start 取得寬度，於拖曳中首次讀浮動分身寬度並快取。
  // ⚠ 必須在確認 overValid（上方稍早已移除 forbidden/delete body class）之後才量：
  //   非法區時 .dragging-forbidden 會給分身加 1.5px 紅框，width:auto 的分身
  //   shrink-to-fit 連 border 一起算，量出來多 3px → 落點空欄比落地區塊寬，
  //   鬆手後欄寬「略微縮水」（通用與模板區塊皆中招）。
  if (_dragState.draggingWidth === 0) {
    const fallbackEl = document.querySelector('.sortable-fallback');
    if (fallbackEl) _dragState.draggingWidth = fallbackEl.getBoundingClientRect().width;
  }

  // 先完成泳道/角色驗證（canPreview）再解析落點，避免不合法時誤推進遲滯狀態。
  if (!evaluation.canPreview) {
    _dragState.previewInsertAfterIndex = null;
    _dragState.previewSlotIndex = null;
    clearHysteresis();
    return;
  }
  _dragState.previewInsertAfterIndex = resolveAfterIndex(clientX);
  _dragState.previewSlotIndex = evaluation.previewSlotIndex;
}

// 自動捲動（4.4f）由 RotationBoard 的 RAF 迴圈在每幀實際捲動後呼叫。
// 落點 hit-test 已全面改用即時 DOM（游標與區塊同幀讀取），捲動座標自動一致，
// 不需 baseline 補償；此處僅以最後游標座標重新評估一次，使「游標靜止、內容自動捲動」時
// 落點空欄隨內容滾過游標而即時更新（遲滯帶會在空欄滑離游標時觸發換格）。
function notifyAutoScroll(): void {
  if (!_dragState.isDragging) return;
  // 浮動分身 pointer-events:none 會穿透，elementFromPoint 取到的是底下真實元素（與 mousemove target 一致）
  const target = document.elementFromPoint(_lastClientX, _lastClientY);
  _evaluateDropTarget(_lastClientX, _lastClientY, target instanceof Element ? target : null);
}

// ── 拖曳刪除的消失動畫（delete-ghost）──────────────────────────
// forceFallback 的浮動分身在 SortableJS onEnd 前就被移除，泳道原區塊又在拖曳期間
// 隱藏＋自欄寬排除，兩者都無法播「原地淡出」。解法：在 capture 階段的 mouseup
// （早於 SortableJS document 層 bubble 的 _onDrop 清理）克隆分身＋記下螢幕位置，
// 確認落點為刪除時，把克隆固定在原位補播紅紋淡出/縮小動畫（.drag-delete-fade）。
const DELETE_GHOST_MS = 220; // 動畫 180ms + 保險餘裕
let _deleteGhostSnapshot: { node: HTMLElement; rect: DOMRect } | null = null;

function _captureDeleteGhost(): void {
  _deleteGhostSnapshot = null;
  if (!_dragState.isDragging) return;
  if (_dragState.sourceType !== 'rotation-instance') return;
  if (!_dragState.isOverDeleteZone || _dragState.isOverSidebar) return;
  if (prefersReducedMotion()) return;
  const fallbackEl = document.querySelector('.sortable-fallback');
  if (!(fallbackEl instanceof HTMLElement)) return;
  _deleteGhostSnapshot = {
    node: fallbackEl.cloneNode(true) as HTMLElement,
    rect: fallbackEl.getBoundingClientRect(),
  };
}

// 落地確定是刪除後才呼叫：把克隆掛回 body 原螢幕位置播淡出，動畫尾移除。
function _playDeleteGhost(): void {
  const snap = _deleteGhostSnapshot;
  _deleteGhostSnapshot = null;
  if (!snap) return;
  const { node, rect } = snap;
  // 清掉 SortableJS 寫在分身上的 inline 定位（top/left/transform），改由外層 wrapper 定位。
  node.style.position = 'static';
  node.style.top = '';
  node.style.left = '';
  node.style.transform = 'none';
  node.style.margin = '0';
  const wrapper = document.createElement('div');
  wrapper.className = 'drag-delete-fade';
  wrapper.style.left = `${rect.left}px`;
  wrapper.style.top = `${rect.top}px`;
  wrapper.appendChild(node);
  document.body.appendChild(wrapper);
  setTimeout(() => wrapper.remove(), DELETE_GHOST_MS);
}

let _isDragOverListenerAttached = false;

function _attachDragOverListener(): void {
  if (_isDragOverListenerAttached) return;
  window.addEventListener('mousemove', _handleDragOver);
  // capture 階段：搶在 SortableJS 移除浮動分身前克隆（見 _captureDeleteGhost 註解）
  window.addEventListener('mouseup', _captureDeleteGhost, true);
  _isDragOverListenerAttached = true;
}

function _detachDragOverListener(): void {
  if (!_isDragOverListenerAttached) return;
  window.removeEventListener('mousemove', _handleDragOver);
  window.removeEventListener('mouseup', _captureDeleteGhost, true);
  _isDragOverListenerAttached = false;
}

// 完整收尾：重置狀態欄位＋body class（state.ts）、清遲滯（resolver）、卸監聽、清座標。
function _teardown(): void {
  resetDragState();
  clearHysteresis();
  _lastClientX = 0;
  _lastClientY = 0;
  _detachDragOverListener();
}

export function useBlockDrag() {
  const rotationStore = useRotationStore();
  const characterStore = useCharacterStore();
  // 顯式標註對外型別，避免 readonly() 的型別推論在部分 Volar 版本展開
  // DeepReadonly<UnwrapNestedRefs<…>> 時掉欄位（如 draggingIds 誤判不存在）。
  const dragState: DeepReadonly<DragState> = readonly(_dragState);

  // 取得（必要時生成）本次側邊欄拖曳的「未來實體 id」。
  // SortableJS 的 :clone 與我們的 @start 事件觸發順序不保證，兩邊都透過此函式
  // 取得同一個 id，確保拖曳預覽暫時物件與正式寫入 store 的資料 id 一致。
  function getOrCreatePendingInstanceId(): string {
    if (!_dragState.pendingInstanceId) {
      _dragState.pendingInstanceId = generateUUID();
    }
    return _dragState.pendingInstanceId;
  }

  /**
   * onSidebarDragStart：側邊欄（預設/模板庫）開始拖曳。
   * @param block - 實際被抓起的區塊（決定 put 規則與浮動分身寬度）
   * @param blocks - 多選整組來源（依選取先後順序）；省略或單一時即視為單拖
   */
  function onSidebarDragStart(
    block: GeneralBlock | TemplateBlock,
    blocks?: (GeneralBlock | TemplateBlock)[]
  ): void {
    const pendingInstanceId = getOrCreatePendingInstanceId();
    _dragState.isDragging = true;
    _dragState.sourceType = block.source === 'general' ? 'sidebar-general' : 'sidebar-template';
    _dragState.draggingId = pendingInstanceId;
    _dragState.draggingSourceBlock = block;
    _dragState.draggingSourceBlocks = blocks && blocks.length > 1 ? [...blocks] : [block];
    _dragState.draggingSlotIndex = null;
    _dragState.isOverSidebar = false;
    _dragState.isOverInvalidZone = false;
    _dragState.isOverDeleteZone = false;
    _dragState.previewInsertAfterIndex = null;
    _dragState.draggingIds = [];
    // 側邊欄來源寬度於拖曳中由浮動分身量得（_handleDragOver）
    _dragState.draggingWidth = 0;
    _attachDragOverListener();
  }

  function onRotationDragStart(entry: RotationEntry, width = 0): void {
    _dragState.isDragging = true;
    _dragState.sourceType = 'rotation-instance';
    _dragState.draggingId = entry.id;
    _dragState.draggingSourceBlock = null;
    _dragState.pendingInstanceId = null;
    _dragState.draggingSlotIndex = entry.slotIndex;
    _dragState.isOverSidebar = false;
    _dragState.isOverInvalidZone = false;
    _dragState.isOverDeleteZone = false;
    _dragState.previewInsertAfterIndex = null;
    // 多選拖曳：抓起的區塊本身在選取集合且有複數選取時，整組一起拖（依全域順序）。
    // 否則只拖這一個。
    const sel = rotationStore.selectedIds;
    if (sel.has(entry.id) && sel.size > 1) {
      _dragState.draggingIds = rotationStore.entries
        .filter((e) => sel.has(e.id))
        .map((e) => e.id);
    } else {
      _dragState.draggingIds = [entry.id];
    }
    // 主軸來源：被拖區塊原欄寬，作為落點空欄寬度（由 Swimlane 量 DOM 傳入；
    // 多選的落點總寬由 RotationBoard previewLayout 依各選中欄寬自行加總）
    _dragState.draggingWidth = width;
    _attachDragOverListener();
  }

  // 側邊欄拖入與同泳道重排的落地全由 handleDragEnd 統一處理（自製全域落點）：
  //  - 不依賴 SortableJS 的 @add/@update index（跨全域排序時 @update 不觸發＝p10-3）。
  //  - 落地與 _teardown 同一個 setTimeout，使 store 更新與 isDragging 轉 false 同拍
  //    批次渲染，避免鬆手瞬間先 reset 回原佈局再寫 store 的中間幀閃爍（n9）。
  function handleDragEnd(_event?: SortableEventLike): void {
    if (!_dragState.isDragging) return;
    // 快照所有落地所需資料（setTimeout 內 _dragState 已被重置）
    const snapshot = {
      sourceType: _dragState.sourceType,
      draggingId: _dragState.draggingId,
      draggingIds: [..._dragState.draggingIds],
      sourceBlock: _dragState.draggingSourceBlock,
      sourceBlocks: [..._dragState.draggingSourceBlocks],
      isOverSidebar: _dragState.isOverSidebar,
      isOverDeleteZone: _dragState.isOverDeleteZone,
      afterIn: _dragState.previewInsertAfterIndex, // 含全部 entries 的全域 after-index
      previewSlot: _dragState.previewSlotIndex,
      pendingId: _dragState.pendingInstanceId ?? undefined,
    };

    // setTimeout：避免打斷 SortableJS 同步清理導致 dragEl 殘留（p1-1）；且與 reset 同拍消除 n9 閃爍。
    setTimeout(() => {
      commitDrop(snapshot);
      // 落點確定為「拖曳刪除」→ 在分身原位補播消失動畫。
      // ⚠ 此條件須與 commit.ts 的 isOverDeleteZone 刪除分支完全對齊（一體兩面，見該處註解）。
      const isDeleteDrop =
        snapshot.sourceType === 'rotation-instance' &&
        !snapshot.isOverSidebar &&
        snapshot.afterIn === null &&
        snapshot.isOverDeleteZone;
      if (isDeleteDrop) _playDeleteGhost();
      else _deleteGhostSnapshot = null;
      _teardown();
    }, 0);
  }

  function getRotationSortableOptions(_slotIndex: SlotIndex) {
    return {
      group: {
        name: 'rotation',
        pull: true,
        // 來源必須是 sidebar group，且 characterId 為 null（通用）或等於本泳道角色
        put: (_to: { options?: { group?: { name?: string } } }, from: { options?: { group?: { name?: string } } }) => {
          if (from?.options?.group?.name !== 'sidebar') return false;
          const sourceBlock = _dragState.draggingSourceBlock;
          if (!sourceBlock) return false;
          if (sourceBlock.characterId === null) return true;
          const targetCharacterId = characterStore.getCharacterIdBySlot(_slotIndex);
          return sourceBlock.characterId === targetCharacterId;
        },
      },
      // 只有真實區塊可被拖曳；排除 grid 內的裝飾節點（落點虛框 .track__preview-slot、
      // 行末的 ＋ 按鈕），否則它們會被算進 SortableJS 的 draggableIndex 而錯位。
      draggable: '.rotation-block',
      // 落點視覺由自製跨泳道預覽負責，關閉 SortableJS 內建排序動畫避免 grid 下微抖
      animation: 0,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 3,
      // 關閉 SortableJS 內建自動捲動：開啟時其浮動分身會在接近可捲動容器
      // （側邊欄）邊緣時做位移補償，導致分身不跟手（位移極小）
      scroll: false,
    } as const;
  }

  function getSidebarSortableOptions() {
    return {
      group: { name: 'sidebar', pull: 'clone', put: false },
      sort: false,
      // 只有 .chip-wrapper 是可拖項：讓 GeneralBlockField 能把「＋新增鈕」等
      // 非區塊節點放在同一拖曳容器內而不被當成可拖項（CustomBlockField 亦僅 .chip-wrapper）。
      draggable: '.chip-wrapper',
      animation: 0,
      ghostClass: 'sortable-ghost',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 3,
      scroll: false,
    } as const;
  }

  return {
    dragState,
    getOrCreatePendingInstanceId,
    onSidebarDragStart,
    onRotationDragStart,
    notifyAutoScroll,
    handleDragEnd,
    getRotationSortableOptions,
    getSidebarSortableOptions,
  };
}

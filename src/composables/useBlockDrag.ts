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
  DELETE_ZONE_BODY_CLASS,
  FORBIDDEN_BODY_CLASS,
  SIDEBAR_ZONE_BODY_CLASS,
  type DragState,
  type SortableEventLike,
} from '@/composables/blockDrag/state';
import { resolveAfterIndex, clearHysteresis } from '@/composables/blockDrag/resolver';
import { commitDrop } from '@/composables/blockDrag/commit';

// 呼叫端沿用本模組的匯出（Swimlane/RotationBoard/SidebarPanel 等），原樣轉出。
export { DROP_ZONE_ATTRIBUTE, DELETE_ZONE_ATTRIBUTE, SIDEBAR_ZONE_ATTRIBUTE };
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

// 落點與區域評估的純函式：座標與目標全由參數帶入（不讀 event），
// 供 mousemove（_handleDragOver）與自動捲動（notifyAutoScroll）共用。
function _evaluateDropTarget(clientX: number, _clientY: number, target: Element | null): void {
  const isRotationSource = _dragState.sourceType === 'rotation-instance';

  // ── 前置：主軸區塊懸停於側邊欄序列化區 → 「拖回存成模板」落點（4.4d）──
  // 走獨立分支：不畫禁止/刪除、不算主軸排序落點，僅標記 isOverSidebar 供 handleDragEnd
  // 走 serializeManyToTemplates。只對主軸來源生效（側邊欄來源拖回側邊欄無意義，維持禁止）。
  const overSidebar = isRotationSource && !!target?.closest(`[${SIDEBAR_ZONE_ATTRIBUTE}]`);
  _dragState.isOverSidebar = overSidebar;
  if (overSidebar) {
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

  const overValid = !!target?.closest(`[${DROP_ZONE_ATTRIBUTE}]`);
  const overDeleteZone = !overValid && !!target?.closest(`[${DELETE_ZONE_ATTRIBUTE}]`);
  const overForbidden = !overValid && !overDeleteZone;

  _dragState.isOverInvalidZone = !overValid;
  _dragState.isOverDeleteZone = overDeleteZone;

  // 主軸區塊在可刪除區 → 紅紋；其餘非合法落點 → 禁止圖標（含側邊欄區塊在可刪除區）
  document.body.classList.toggle(DELETE_ZONE_BODY_CLASS, isRotationSource && overDeleteZone);
  document.body.classList.toggle(
    FORBIDDEN_BODY_CLASS,
    overForbidden || (!isRotationSource && overDeleteZone),
  );

  // ── 自製落點預覽：算出全域 after-index（single thread 跨泳道同步擠出）──
  // 側邊欄來源無法在 @start 取得寬度，於拖曳中首次讀浮動分身寬度並快取。
  if (_dragState.draggingWidth === 0) {
    const fallbackEl = document.querySelector('.sortable-fallback');
    if (fallbackEl) _dragState.draggingWidth = fallbackEl.getBoundingClientRect().width;
  }
  if (!overValid) {
    _dragState.previewInsertAfterIndex = null;
    _dragState.previewSlotIndex = null;
    clearHysteresis(); // 離開合法落點 → 清遲滯，再入時重新即時定位
    return;
  }

  if (isRotationSource) {
    // 主軸來源：歸屬泳道不變、全域位置可任意（不分泳道行）；虛框畫在自己泳道。
    _dragState.previewInsertAfterIndex = resolveAfterIndex(clientX);
    _dragState.previewSlotIndex = _dragState.draggingSlotIndex;
  } else {
    // 側邊欄來源：落點 x 同樣全域，但歸屬泳道＝游標所在泳道（需角色匹配）。
    // 先驗證泳道/角色，再解析落點，避免不合法時誤推進遲滯狀態。
    const lane = target?.closest(`[${DROP_ZONE_ATTRIBUTE}]`) ?? null;
    const slotIndex = lane ? _readSlotIndex(lane) : null;
    if (slotIndex === null) {
      _dragState.previewInsertAfterIndex = null;
      _dragState.previewSlotIndex = null;
      clearHysteresis();
      return;
    }
    const characterStore = useCharacterStore();
    const charId = characterStore.getCharacterIdBySlot(slotIndex);
    const src = _dragState.draggingSourceBlock;
    if (!charId || (src && src.characterId !== null && src.characterId !== charId)) {
      _dragState.previewInsertAfterIndex = null;
      _dragState.previewSlotIndex = null;
      clearHysteresis();
      return;
    }
    _dragState.previewInsertAfterIndex = resolveAfterIndex(clientX);
    _dragState.previewSlotIndex = slotIndex;
  }
}

// 讀取泳道 DOM 上的 data-slot-index
function _readSlotIndex(lane: Element): SlotIndex | null {
  const raw = lane.getAttribute('data-slot-index');
  if (raw === null) return null;
  const n = Number(raw);
  return n === 0 || n === 1 || n === 2 ? (n as SlotIndex) : null;
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

let _isDragOverListenerAttached = false;

function _attachDragOverListener(): void {
  if (_isDragOverListenerAttached) return;
  window.addEventListener('mousemove', _handleDragOver);
  _isDragOverListenerAttached = true;
}

function _detachDragOverListener(): void {
  if (!_isDragOverListenerAttached) return;
  window.removeEventListener('mousemove', _handleDragOver);
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

  function setOverSidebar(val: boolean): void {
    if (_dragState.isDragging) _dragState.isOverSidebar = val;
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
    setOverSidebar,
    notifyAutoScroll,
    handleDragEnd,
    getRotationSortableOptions,
    getSidebarSortableOptions,
  };
}

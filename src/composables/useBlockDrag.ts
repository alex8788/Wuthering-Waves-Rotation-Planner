import { reactive, readonly, type DeepReadonly } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useSidebarStore } from '@/stores/useSidebarStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { generateUUID } from '@/utils/uuid';
import type { DefaultBlock, TemplateBlock } from '@/types/block';
import type { RotationEntry, DragSourceType } from '@/types/rotation';
import type { SlotIndex } from '@/types/character';

// 合法放置容器（泳道）需掛上此屬性，供 _handleDragOver 判斷游標是否在合法落點
export const DROP_ZONE_ATTRIBUTE = 'data-drop-zone';
// 可刪除區（主軸面板內、三條泳道之外的空白）掛此屬性。
// 三區語意：合法落點(泳道) > 可刪除區(主軸面板) > 其餘皆為禁止放置區(標題列/側邊欄/版面外)
export const DELETE_ZONE_ATTRIBUTE = 'data-delete-zone';
// 側邊欄序列化區（自訂模板面板）掛此屬性。主軸區塊拖到此處放開 → 序列化為角色模板。
export const SIDEBAR_ZONE_ATTRIBUTE = 'data-sidebar-zone';

export interface SortableEventLike {
  oldIndex?: number;
  newIndex?: number;
  oldDraggableIndex?: number;
  newDraggableIndex?: number;
  to?: HTMLElement;   // 放置目標容器
  from?: HTMLElement; // 拖曳來源容器
  item?: HTMLElement; // 被拖放的 DOM 元素（跨清單複製時 = SortableJS 插入的克隆節點）
}

interface DragState {
  isDragging: boolean;
  sourceType: DragSourceType | null;
  draggingId: string | null;
  draggingSourceBlock: DefaultBlock | TemplateBlock | null;
  // 側邊欄拖曳開始時就先產生好的「未來實體 id」，讓拖曳預覽用的暫時物件
  // 與之後寫入 store 的正式 InstanceBlock 共用同一個 id（key 全程不變，
  // 避免 SortableJS 追蹤的 DOM 節點被 Vue 中途摧毀重建）
  pendingInstanceId: string | null;
  draggingSlotIndex: SlotIndex | null;
  isOverSidebar: boolean;
  // 游標不在合法落點（泳道）上：含可刪除區與禁止放置區兩種
  isOverInvalidZone: boolean;
  // 游標在可刪除區（主軸面板內、泳道之外）：主軸區塊在此放開才會刪除
  isOverDeleteZone: boolean;
  dropHandled: boolean;
  // ── 自製落點預覽（single thread 跨泳道同步擠出）──────────────
  // 全域 after-index：插在此索引之後（語意同 store moveBlock/instantiateBlock 的 afterIndex；
  // -1=最前、length-1=最後）。null = 目前無合法落點（游標在泳道外/禁止區/跨泳道）。
  previewInsertAfterIndex: number | null;
  // 落點空欄寬度（px）。主軸來源＝被拖區塊原欄寬；側邊欄＝浮動分身寬度。
  draggingWidth: number;
  // 落點所在泳道（畫單欄虛框用）。null = 無合法落點。
  previewSlotIndex: SlotIndex | null;
}

const _dragState = reactive<DragState>({
  isDragging: false,
  sourceType: null,
  draggingId: null,
  draggingIds: [],
  draggingSourceBlock: null,
  pendingInstanceId: null,
  draggingSlotIndex: null,
  isOverSidebar: false,
  isOverInvalidZone: false,
  isOverDeleteZone: false,
  dropHandled: false,
  previewInsertAfterIndex: null,
  draggingWidth: 0,
  previewSlotIndex: null,
});

// forceFallback 模式下 SortableJS 不會觸發原生 dragover，改用 mousemove
// 偵測游標是否在合法容器外（fallback 浮動分身預設 pointer-events: none，
// 滑鼠事件會正常穿透到底下的真實元素）
// forceFallback 模式下真正可見的被拖物件是 SortableJS 的靜態浮動克隆
// .sortable-fallback，拿不到 Vue 響應式更新，因此改用 <body> 全域 class + CSS
// 直接替浮動克隆上樣式。三區語意：
//   - 合法落點(泳道)            → 無警告
//   - 可刪除區(主軸面板內非泳道) → 主軸區塊：刪除紅紋；側邊欄區塊：禁止圖標(無法新增到空白處)
//   - 禁止放置區(其餘)          → 一律禁止圖標(放開彈回)
const DELETE_ZONE_BODY_CLASS = 'dragging-over-delete';
const FORBIDDEN_BODY_CLASS = 'dragging-forbidden';
// 主軸區塊懸停於側邊欄序列化區（拖回存成模板）時的浮動分身樣式
const SIDEBAR_ZONE_BODY_CLASS = 'dragging-over-sidebar';

// 拖曳時的「靜態欄位幾何快照」（含全部 entries 的欄位中心 x，依全域順序、左→右）。
// 由 RotationBoard 於拖曳開始時讀原始佈局填入。落點 hit-test 改用此快照而非即時 DOM，
// 避免「預覽擠出 → layout 位移 → 游標下元素改變」的回饋抖動（p10-1，主軸與側邊欄皆適用）。
let _columnBaseline: { id: string; center: number }[] = [];

// 依游標 x 對應到「全域欄位間隙」的 after-index（含全部 entries 語意，與 store moveBlock/
// instantiateBlock 的 afterIndex 一致；-1=最前）。不分泳道 → 可橫跨全域 grid-column 排序（p10-2）。
function _afterInFromX(clientX: number): number {
  let k = -1;
  for (let i = 0; i < _columnBaseline.length; i++) {
    if (_columnBaseline[i].center < clientX) k = i;
    else break;
  }
  return k;
}

function _handleDragOver(event: MouseEvent): void {
  if (!_dragState.isDragging) return;
  // 游標可能落在 document/window 等非 Element 目標上（無 closest 方法），需防護。
  const target = event.target instanceof Element ? event.target : null;
  const isRotationSource = _dragState.sourceType === 'rotation-instance';

  // ── 前置：主軸區塊懸停於側邊欄序列化區 → 「拖回存成模板」落點（4.4d）──
  // 走獨立分支：不畫禁止/刪除、不算主軸排序落點，僅標記 isOverSidebar 供 handleDragEnd
  // 走 serializeToTemplate。只對主軸來源生效（側邊欄來源拖回側邊欄無意義，維持禁止）。
  const overSidebar = isRotationSource && !!target?.closest(`[${SIDEBAR_ZONE_ATTRIBUTE}]`);
  _dragState.isOverSidebar = overSidebar;
  if (overSidebar) {
    _dragState.isOverInvalidZone = true;
    _dragState.isOverDeleteZone = false;
    _dragState.previewInsertAfterIndex = null;
    _dragState.previewSlotIndex = null;
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
    return;
  }

  // 落點 x 一律用靜態幾何快照算（主軸與側邊欄共用，避免 elementFromPoint 讀即時 DOM 的抖動）。
  const afterIn = _afterInFromX(event.clientX);

  if (isRotationSource) {
    // 主軸來源：歸屬泳道不變、全域位置可任意（不分泳道行）；虛框畫在自己泳道。
    _dragState.previewInsertAfterIndex = afterIn;
    _dragState.previewSlotIndex = _dragState.draggingSlotIndex;
  } else {
    // 側邊欄來源：落點 x 同樣全域，但歸屬泳道＝游標所在泳道（需角色匹配）。
    const lane = target?.closest(`[${DROP_ZONE_ATTRIBUTE}]`) ?? null;
    const slotIndex = lane ? _readSlotIndex(lane) : null;
    if (slotIndex === null) {
      _dragState.previewInsertAfterIndex = null;
      _dragState.previewSlotIndex = null;
      return;
    }
    const characterStore = useCharacterStore();
    const charId = characterStore.getCharacterIdBySlot(slotIndex);
    const src = _dragState.draggingSourceBlock;
    if (!charId || (src && src.characterId !== null && src.characterId !== charId)) {
      _dragState.previewInsertAfterIndex = null;
      _dragState.previewSlotIndex = null;
      return;
    }
    _dragState.previewInsertAfterIndex = afterIn;
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

function _resetDragState(): void {
  _dragState.isDragging = false;
  _dragState.sourceType = null;
  _dragState.draggingId = null;
  _dragState.draggingIds = [];
  _dragState.draggingSourceBlock = null;
  _dragState.pendingInstanceId = null;
  _dragState.draggingSlotIndex = null;
  _dragState.isOverSidebar = false;
  _dragState.isOverInvalidZone = false;
  _dragState.isOverDeleteZone = false;
  _dragState.dropHandled = false;
  _dragState.previewInsertAfterIndex = null;
  _dragState.draggingWidth = 0;
  _dragState.previewSlotIndex = null;
  _columnBaseline = [];
  document.body.classList.remove(DELETE_ZONE_BODY_CLASS);
  document.body.classList.remove(FORBIDDEN_BODY_CLASS);
  document.body.classList.remove(SIDEBAR_ZONE_BODY_CLASS);
  _detachDragOverListener();
}

export function useBlockDrag() {
  const rotationStore = useRotationStore();
  const sidebarStore = useSidebarStore();
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

  function onSidebarDragStart(block: DefaultBlock | TemplateBlock): void {
    const pendingInstanceId = getOrCreatePendingInstanceId();
    _dragState.isDragging = true;
    _dragState.sourceType = block.source === 'default' ? 'sidebar-default' : 'sidebar-template';
    _dragState.draggingId = pendingInstanceId;
    _dragState.draggingSourceBlock = block;
    _dragState.draggingSlotIndex = null;
    _dragState.dropHandled = false;
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
    _dragState.dropHandled = false;
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

  // 側邊欄拖入與同泳道重排的落地都改由 handleDragEnd 統一處理（用自製全域落點）：
  //  - 不依賴 SortableJS 的 @add/@update index（跨全域排序時 @update 不觸發＝p10-3）。
  //  - 落地與 _resetDragState 放在同一個 setTimeout，使「store 更新」與「isDragging 轉 false」
  //    在同一拍批次渲染，避免鬆手瞬間先 reset 回原始佈局、再寫 store 的中間幀閃爍（n9）。
  function handleSidebarToLaneDrop(_event: SortableEventLike, _targetSlotIndex: SlotIndex): void {
    _dragState.dropHandled = true;
  }

  function handleSameLaneDrop(_event: SortableEventLike, _slotIndex: SlotIndex): void {
    _dragState.dropHandled = true;
  }

  function handleDragEnd(_event?: SortableEventLike): void {
    if (!_dragState.isDragging) return;
    // 快照所有落地所需資料（setTimeout 內 _dragState 已被重置）
    const sourceType = _dragState.sourceType;
    const draggingId = _dragState.draggingId;
    const draggingIds = [..._dragState.draggingIds];
    const sourceBlock = _dragState.draggingSourceBlock;
    const isOverSidebar = _dragState.isOverSidebar;
    const isOverDeleteZone = _dragState.isOverDeleteZone;
    const afterIn = _dragState.previewInsertAfterIndex; // 含全部 entries 的全域 after-index
    const previewSlot = _dragState.previewSlotIndex;
    const pendingId = _dragState.pendingInstanceId ?? undefined;

    // setTimeout：避免打斷 SortableJS 同步清理導致 dragEl 殘留（p1-1）；且與 reset 同拍消除 n9 閃爍。
    setTimeout(() => {
      if (sourceType === 'rotation-instance' && draggingId) {
        const isMulti = draggingIds.length > 1;
        if (isOverSidebar) {
          const entry = rotationStore.entries.find((e) => e.id === draggingId);
          if (entry) sidebarStore.serializeToTemplate(entry.block);
        } else if (afterIn !== null) {
          // 全域重排：afterIn 已是「含全部」語意。多選整組以鼠標錨點插入、相對順序不變。
          if (isMulti) rotationStore.moveBlocks(draggingIds, afterIn);
          else rotationStore.moveBlock(draggingId, afterIn);
        } else if (isOverDeleteZone) {
          // 無合法落點且在可刪除區 → 刪除（多選刪整組）；禁止放置區一律彈回不刪
          if (isMulti) draggingIds.forEach((id) => rotationStore.deleteBlock(id));
          else rotationStore.deleteBlock(draggingId);
        }
      } else if (sourceBlock && afterIn !== null && previewSlot !== null) {
        // 側邊欄來源落入泳道：再次角色校驗（雙重防線），用 previewSlot 決定歸屬泳道。
        const targetCharacterId = characterStore.getCharacterIdBySlot(previewSlot);
        const isMatch =
          targetCharacterId &&
          (sourceBlock.characterId === null || sourceBlock.characterId === targetCharacterId);
        if (targetCharacterId && isMatch) {
          rotationStore.instantiateBlock(sourceBlock, previewSlot, targetCharacterId, afterIn, pendingId);
        }
      }
      _resetDragState();
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
      animation: 0,
      ghostClass: 'sortable-ghost',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 3,
      scroll: false,
    } as const;
  }

  // 由 RotationBoard 於主軸拖曳開始時填入靜態欄位幾何（排除被拖自己、依全域順序）。
  function setColumnBaseline(baseline: { id: string; center: number }[]): void {
    _columnBaseline = baseline;
  }

  return {
    dragState,
    getOrCreatePendingInstanceId,
    onSidebarDragStart,
    onRotationDragStart,
    setOverSidebar,
    setColumnBaseline,
    handleSidebarToLaneDrop,
    handleSameLaneDrop,
    handleDragEnd,
    getRotationSortableOptions,
    getSidebarSortableOptions,
  };
}
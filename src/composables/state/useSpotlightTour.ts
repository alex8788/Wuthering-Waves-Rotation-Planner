// ============================================================
// useSpotlightTour.ts — 首訪功能導覽（Spotlight Tour，driver.js 驅動）。
//
// 職責：
//   - 首訪旗標持久化（wuwa-rotation-tour-seen）。
//   - 開始導覽時「快照當前版面 → 注入示範隊伍（3 角色 + 區塊）」，
//     結束/跳過/Esc 時還原，讓步驟能 spotlight 真實的泳道/區塊元件。
//   - 以 driver.js 呈現 spotlight 遮罩、氣泡、步驟切換、自動捲動。
//   - 導覽期間以 A/D 鍵作上一步/下一步（capture 攔截，覆蓋原區塊巡覽）。
//
// 注意：示範資料以「直接指派 store ref」注入（仿 useSavedTeamStore.loadTeam），
//       不走會污染 undo 的 action；結束時指派回快照即復原。
//       罕見邊角：導覽中途關閉分頁，示範資料可能被持久化保留；因 hasSeenTour
//       已設 true 不會自動重播，使用者可自行清空。
// ============================================================

import { ref, nextTick } from 'vue';
// driver.js 是重套件（僅首訪導覽/手動開啟導覽才用到）：只保留 type import
// （型別於編譯期抹除、無執行期成本），真正的 driver 函式與其 CSS 於 start() 內
// 動態 import()，拆成獨立 chunk、首屏不載入。
import type { Driver, DriveStep } from 'driver.js';
import { t } from '@/i18n';
import { deepClone } from '@/utils/deepClone';
import { generateUUID } from '@/utils/uuid';
import { getElementColor } from '@/constants/elements';
import { CHARACTER_MAP } from '@/constants/characters';
import { useRotationStore } from '@/stores/useRotationStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useLaneOrder } from '@/composables/state/useLaneOrder';
import { useHistory } from '@/composables/state/useHistory';
import { useSidebarCollapse } from '@/composables/state/useSidebarCollapse';
import {
  runDemo,
  cancelDemo,
  setTourApi,
  hotkeyLaneProxy,
  syncHotkeyLaneProxy,
  removeHotkeyLaneProxy,
} from '@/composables/state/useTourDemo';
import { useHotkeyInputMode } from '@/composables/state/useHotkeyInputMode';
import { suspendPersistence, resumePersistence } from '@/composables/state/persistenceGuard';
import { computeCenterScrollLeft } from '@/composables/board/useBoardScroll';
import { useHotkeyMap } from '@/composables/state/useHotkeyMap';
import type { HotkeyMapEntry, IntroHotkeyEntry } from '@/types/hotkey';
import type { CharacterSlots, SlotIndex } from '@/types/character';
import type { RotationAxis, RotationEntry } from '@/types/rotation';
import type { InstanceBlock, TemplateBlock } from '@/types/block';

const STORAGE_KEY = 'wuwa-rotation-tour-seen';
// 熱鍵輸入模式導覽的首訪旗標（與主導覽獨立：各自首播、各自重播）。
const HOTKEY_STORAGE_KEY = 'wuwa-rotation-hotkey-tour-seen';

function loadSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}
function persistSeen(key: string): void {
  try {
    localStorage.setItem(key, 'true');
  } catch (e) {
    console.warn('[useSpotlightTour] 首訪旗標寫入失敗', e);
  }
}

// ── module 單例狀態 ─────────────────────────────────────────
const isActive = ref(false);
const hasSeenTour = ref(loadSeen(STORAGE_KEY));
const hasSeenHotkeyTour = ref(loadSeen(HOTKEY_STORAGE_KEY));
// 當前導覽變體：主導覽（首訪 12 步）或熱鍵輸入模式導覽（2 步）。
type TourVariant = 'main' | 'hotkey';
let variant: TourVariant = 'main';
// 熱鍵導覽進入模式後，等側欄收合過渡（AppLayout 0.25s）定型的緩衝時長，
// 定型後才 drive 並開始輸入，避免 spotlight 先套展開版面再跳位。
const HOTKEY_LAYOUT_SETTLE_MS = 380;
let driverObj: Driver | null = null;
// 抑制旗標：demo 內用 driver.highlight 移動焦點時，driver 會內部觸發 onDeselected，
// 若不抑制會誤把正在播放的 demo 取消。refocus 期間暫設 true。
let suppressCancel = false;
// 導覽開始前的 UI 暫態快照（側欄收合狀態 + 作用中分頁）：導覽期間會被示範強制
// 改動（展開側欄、切到「通用」分頁），結束由 restoreUiState 還原。刻意與 store
// 切片分開處理——這些是 UI 局部狀態，且必須在「熱鍵導覽收合側欄之前」於 begin
// 早期擷取，時機早於延後注入的 injectDemo，故不併入 buildRestorableSlices。
interface UiSnapshot {
  collapsed: boolean;
  activeTab: 'tab-general' | 'tab-custom' | null;
}
let uiSnapshot: UiSnapshot | null = null;

/** 把 spotlight 焦點移到選擇器指向的元件，保留當前步驟氣泡（供 demo 中途換焦點）。 */
function refocus(selector: string): void {
  if (!driverObj) return;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  const steps = variant === 'hotkey' ? buildHotkeySteps() : buildSteps();
  const idx = driverObj.getActiveIndex() ?? 0;
  const basePop = steps[idx]?.popover ?? {};
  suppressCancel = true;
  // driver.highlight() 內部預設 { showButtons:[], showProgress:false, ...popover }，
  // 會清掉上一步/下一步鈕與進度；這裡補回按鈕、進度與導覽點擊處理，
  // 使 refocus 後的氣泡與正常步驟一致（progressText 直接給定字串，避免 highlight
  // 模式不會替換 {{current}}/{{total}} 佔位符）。
  driverObj.highlight({
    element: el,
    popover: {
      ...basePop,
      showButtons: ['next', 'previous', 'close'],
      showProgress: true,
      progressText: `${idx + 1} / ${steps.length}`,
      nextBtnText: `${t('tour.next')} (D)`,
      prevBtnText: `${t('tour.prev')} (A)`,
      onNextClick: () => driverObj?.moveNext(),
      onPrevClick: () => driverObj?.movePrevious(),
      onCloseClick: () => driverObj?.destroy(),
    },
  });
  // highlight 的內部 onDeselected 為同步觸發；用 microtask 保險復位。
  queueMicrotask(() => { suppressCancel = false; });
}

/**
 * 可還原切片：導覽期間會被示範資料覆蓋、結束須原樣還原的一份狀態。
 *   - capture()：擷取當前值（一律深拷貝，reactive-safe）。
 *   - restore(v)：把 capture 的值指派回原處。
 * 設計目的（Phase 2）：以「登記表」取代手工列舉的快照結構——新增任何持久化
 * 狀態時，只要在 buildRestorableSlices 註冊一個切片，就同時被快照與還原涵蓋，
 * 不會再發生「加了新欄位卻忘了還原」的漏接。name 供除錯與未來漂移斷言用。
 */
interface RestorableSlice {
  name: string;
  capture: () => unknown;
  restore: (value: unknown) => void;
}

/**
 * 建立導覽需快照/還原的所有狀態切片（每次呼叫即時綁定當前 store 實例）。
 * 一律「全部快照、全部還原」，不依 variant 分歧：還原成相同值是無害的 no-op，
 * 但少了條件分支就少了漏接的可能——這正是系統化邊界的重點。
 */
function buildRestorableSlices(): RestorableSlice[] {
  const rotationStore = useRotationStore();
  const characterStore = useCharacterStore();
  const templateStore = useTemplateStore();
  const { laneOrder } = useLaneOrder();
  const history = useHistory();
  const hotkeyMap = useHotkeyMap();
  return [
    { name: 'characterSlots',
      capture: () => deepClone(characterStore.slots),
      restore: (v) => { characterStore.slots = deepClone(v as CharacterSlots); } },
    { name: 'axes',
      capture: () => deepClone(rotationStore.axes),
      restore: (v) => { rotationStore.axes = deepClone(v as RotationAxis[]); } },
    { name: 'activeAxisId',
      capture: () => rotationStore.activeAxisId,
      restore: (v) => { rotationStore.activeAxisId = v as string; } },
    { name: 'laneOrder',
      capture: () => deepClone(laneOrder.value),
      restore: (v) => { laneOrder.value = deepClone(v as SlotIndex[]); } },
    { name: 'templates',
      capture: () => deepClone(templateStore.templates),
      restore: (v) => { templateStore.templates = deepClone(v as TemplateBlock[]); } },
    { name: 'history',
      capture: () => history.snapshotStacks(),
      restore: (v) => history.restoreStacks(v as ReturnType<typeof history.snapshotStacks>) },
    { name: 'hotkeyEntries',
      capture: () => deepClone(hotkeyMap.entries.value),
      restore: (v) => { hotkeyMap.entries.value = deepClone(v as HotkeyMapEntry[]); } },
    { name: 'introEntries',
      capture: () => deepClone(hotkeyMap.introEntries.value),
      restore: (v) => { hotkeyMap.introEntries.value = deepClone(v as IntroHotkeyEntry[]); } },
  ];
}

/** 導覽開始前的版面快照（切片名 → capture 值；結束時還原）。 */
let snapshot: Record<string, unknown> | null = null;
/** 示範版面基準（供每次示範動畫重設，確保可重複播放）。 */
let demoBaseline: { slots: CharacterSlots; axis: RotationAxis; laneOrder: SlotIndex[] } | null = null;

/** 示範隊伍三角色（依畫面上→下對應泳道 0/1/2）。 */
const DEMO_CHAR_IDS: [string, string, string] = ['changli', 'chisaki', 'amis'];

/** 示範區塊：依畫面左→右的時間軸順序（entries 陣列索引＝水平欄位），
 *  交錯排列使區塊呈上下錯開的鋸齒狀（對照使用者提供的示範截圖）。 */
const DEMO_SEQUENCE: { slot: SlotIndex; label: string }[] = [
  { slot: 0, label: 'E' },
  { slot: 0, label: 'RZ' },
  { slot: 2, label: 'AAAA' },
  { slot: 2, label: 'AAE' },
  { slot: 1, label: 'E' },
  { slot: 1, label: '2A' },
  { slot: 0, label: 'A' },
];

/** 建立示範隊伍的角色槽與輸出軸（固定重現示範截圖狀態）。 */
function buildDemo(): { slots: CharacterSlots; axis: RotationAxis } {
  const chars = DEMO_CHAR_IDS.map((id) => CHARACTER_MAP[id] ?? null);
  const slots = [0, 1, 2].map((i) => ({
    slotIndex: i as SlotIndex,
    character: chars[i],
  })) as CharacterSlots;

  const entries: RotationEntry[] = DEMO_SEQUENCE.map(({ slot, label }) => {
    const char = chars[slot];
    const block: InstanceBlock = {
      id: generateUUID(),
      source: 'instance',
      characterId: char?.id ?? '',
      originId: null,
      label,
      color: getElementColor(char?.element ?? null),
      tags: [],
    };
    return { id: block.id, slotIndex: slot, block };
  });

  const axis: RotationAxis = {
    id: generateUUID(),
    name: t('tour.demoAxisName'),
    entries,
  };
  return { slots, axis };
}

/** 快照當前版面並注入示範資料。 */
function injectDemo(): void {
  const rotationStore = useRotationStore();
  const characterStore = useCharacterStore();
  const { laneOrder } = useLaneOrder();

  // 系統化快照：逐一擷取登記表中每個切片（新增狀態只要註冊即自動涵蓋）。
  snapshot = {};
  for (const slice of buildRestorableSlices()) snapshot[slice.name] = slice.capture();

  // 熱鍵導覽：示範按鍵（E/Q/R/左鍵長按/長按2）須與旁白一致 → 暫換預設種子表。
  if (variant === 'hotkey') useHotkeyMap().resetToDefaults();

  const { slots, axis } = buildDemo();
  demoBaseline = { slots: deepClone(slots), axis: deepClone(axis), laneOrder: [0, 1, 2] };
  characterStore.slots = slots;
  rotationStore.axes = [axis];
  rotationStore.activeAxisId = axis.id;
  laneOrder.value = [0, 1, 2];
}

/** 把示範版面重設為基準（示範動畫開始前呼叫，清掉前一次殘留變更）。 */
function resetDemoBoard(): void {
  if (!demoBaseline || !snapshot) return;
  const rotationStore = useRotationStore();
  const characterStore = useCharacterStore();
  const templateStore = useTemplateStore();
  const { laneOrder } = useLaneOrder();

  characterStore.slots = deepClone(demoBaseline.slots);
  rotationStore.axes = [deepClone(demoBaseline.axis)];
  rotationStore.activeAxisId = rotationStore.axes[0].id;
  // 泳道順序也重設回基準：否則 n6 拖曳重排後的順序會殘留到後續步驟。
  laneOrder.value = deepClone(demoBaseline.laneOrder);
  // 示範期間模板庫清空：避免使用者既有同名模板使「存模板」被去重略過，
  // 也讓示範新增的 chip 一定是清單裡唯一/最後一個。結束時 restore 還原。
  templateStore.templates = [];
  rotationStore.clearSelection();
  rotationStore.stopEditing();
  // 熱鍵導覽變體：側欄開合由模式自己管（進入收合/退出還原），分頁與側欄不動；
  // 捲動位置也不動——由幽靈格置中（enter()/useGhostConveyor）全權掌管，
  // 若在此歸零會與置中捲動互搶、每次進入步驟都把軸面猛拉一次。
  if (variant === 'main') {
    // 側邊欄一律保持展開（步驟 2/4 需要）：避免任何步驟殘留的收合狀態影響後續步驟。
    useSidebarCollapse().collapsed.value = false;
    // 側邊欄分頁重設回預設「通用」：避免 n2 切到「自訂」的分頁殘留到後續步驟。
    clickTab('tab-general');
    // 水平捲動歸零：使 spotlight 邊框左緣與泳道 header 左緣對齊。前一步（n5 貼上/復原）
    // 會把 board 捲到最右端，導致 .board__lanes 左緣被捲出視窗外，step8 的高亮框左緣
    // 因而與 sticky 定位的泳道 header 左緣錯開。於 post-render 歸零讓兩者對齊。
    nextTick(() => {
      const scroll = document.querySelector<HTMLElement>('.board__scroll');
      if (scroll) scroll.scrollLeft = 0;
    });
  }
}

/** 還原導覽開始前的版面。 */
function restore(): void {
  if (!snapshot) return;
  const rotationStore = useRotationStore();

  // 系統化還原：逐一把登記表切片指派回原處（涵蓋角色槽/軸/泳道順序/模板/
  // undo-redo 佇列/熱鍵對映表）。順序與 capture 一致，彼此獨立無耦合。
  const captured = snapshot;
  for (const slice of buildRestorableSlices()) {
    if (slice.name in captured) slice.restore(captured[slice.name]);
  }
  rotationStore.clearSelection();
  rotationStore.stopEditing();
  snapshot = null;
  demoBaseline = null;
}

/** 切換側邊欄分頁（步驟 2/4 進場時呼叫）。 */
function clickTab(id: 'tab-general' | 'tab-custom'): void {
  (document.getElementById(id) as HTMLElement | null)?.click();
}

/** 擷取 UI 暫態（側欄收合 + 作用中分頁）。分頁狀態為 SidebarPanel 局部 ref，
 *  無全域入口，改讀 DOM 的 aria-selected 判定；讀不到（側欄未渲染）則記 null。 */
function captureUiState(): void {
  uiSnapshot = {
    collapsed: useSidebarCollapse().collapsed.value,
    activeTab: document.querySelector('#tab-custom[aria-selected="true"]')
      ? 'tab-custom'
      : document.querySelector('#tab-general[aria-selected="true"]')
        ? 'tab-general'
        : null,
  };
}

/** 還原 UI 暫態：先還原分頁（趁側欄仍展開、DOM 尚在），再還原收合狀態。
 *  修正舊實作只重設成「通用」卻從不還原使用者原分頁的缺漏。 */
function restoreUiState(): void {
  if (!uiSnapshot) return;
  if (uiSnapshot.activeTab) clickTab(uiSnapshot.activeTab);
  useSidebarCollapse().collapsed.value = uiSnapshot.collapsed;
  uiSnapshot = null;
}

/** 進入導覽沙盒（begin 早期呼叫）：暫停持久化 + 擷取 UI 暫態快照。
 *  示範資料注入（injectDemo）因主/熱鍵變體時機不同，仍由 begin 各自於適當時點呼叫。 */
function enterSandbox(): void {
  suspendPersistence();
  captureUiState();
}

/** 離開導覽沙盒（handleDestroyed 呼叫，idempotent）：統一收拾所有暫態並還原。
 *  順序：DOM/模式暫態 → 還原 store 切片 → 恢復持久化 → 還原 UI 暫態。 */
function exitSandbox(): void {
  cancelDemo(); // 收掉示範指標、進行中拖曳、角色下拉、確認框、熱鍵導覽殘留
  // 熱鍵導覽變體：先退出模式（清泳道選取、還原側欄由模式自理），再移除代理框。
  if (variant === 'hotkey') {
    useHotkeyInputMode().exit();
    removeHotkeyLaneProxy();
  }
  restore(); // 還原 store 切片（角色/軸/泳道順序/模板/歷史/熱鍵對映表）
  // 還原真值已指派回各 ref → 恢復持久化：該指派觸發的 deep watch 會於下一輪
  // 以「真值 + 已恢復寫入」重新寫檔，localStorage 與記憶體重新一致。
  resumePersistence();
  restoreUiState(); // 還原側欄收合與作用中分頁
}

type PopoverSide = 'top' | 'right' | 'bottom' | 'left';
type PopoverAlign = 'start' | 'center' | 'end';

/** 依當前語言組建 driver.js 步驟。 */
function buildSteps(): DriveStep[] {
  const step = (
    n: number,
    element: string,
    side: PopoverSide = 'bottom',
    align: PopoverAlign = 'start',
  ): DriveStep => ({
    element,
    popover: {
      title: t(`tour.step${n}Title`),
      description: t(`tour.step${n}Desc`),
      side,
      align,
    },
    // 每步進場一律把示範版面重設為截圖基準狀態。
    onHighlighted: () => resetDemoBoard(),
  });

  // 收尾三步（隊伍/匯出/說明）用「固定命名鍵」而非數字編號：永遠掛在導覽最尾端，
  // 之後於中段插入新的教學步驟時，這三步不必再跟著重編號（避免多語系連動改動）。
  const namedStep = (
    key: 'Teams' | 'Export' | 'Help',
    element: string,
    side: PopoverSide = 'bottom',
    align: PopoverAlign = 'start',
  ): DriveStep => ({
    element,
    popover: {
      title: t(`tour.step${key}Title`),
      description: t(`tour.step${key}Desc`),
      side,
      align,
    },
    onHighlighted: () => resetDemoBoard(),
  });

  // 每一步進場（onHighlighted）都先把示範版面載入為截圖基準狀態，
  // 之後再疊加該步的「真實互動效果」動畫（依步驟逐一建置）。
  return [
    // n1：選角/取消選角（c3 泳道 header；氣泡放頭像右上，避免被任何語言的角色選單遮擋）。
    { ...step(1, '[data-tour="lane-header"]', 'top'), onHighlighted: () => { resetDemoBoard(); runDemo(1); } },
    // n2：模板庫（合併原 o2 通用模板庫 + o4 角色模板；全程不聚焦、以 .app-layout 當「無 spotlight」）。
    {
      ...step(2, '.app-layout', 'top', 'center'),
      onHighlightStarted: () => clickTab('tab-general'),
      onHighlighted: () => { resetDemoBoard(); runDemo(2); },
    },
    // n3：新增與編輯區塊（合併原 o3/o5）。
    { ...step(3, '[data-slot-index="0"]', 'left', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(3); } },
    // o6（新編號 4）：多重選取。
    { ...step(4, '.board__lanes', 'top', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(4); } },
    // o7（新編號 5）：刪除區塊。
    { ...step(5, '.rotation-board', 'top', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(5); } },
    // n4（編號 6）：區塊巡覽。
    { ...step(6, '.board__lanes', 'top', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(6); } },
    // n5（編號 7）：剪貼簿與歷史（highlight 用尺寸穩定的 .rotation-board，避免
    //   貼上新增欄位使 .board__lanes 變寬時 spotlight 框跟著位移）。
    { ...step(7, '.rotation-board', 'top', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(7); } },
    // n6（編號 8）：調整角色順序（拖曳泳道重排）。
    { ...step(8, '.board__lanes', 'right', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(8); } },
    step(9, '.axis-tabbar', 'top', 'center'),
    // ── 收尾三步（固定掛最末端；未來新步驟插在本行之前）──
    namedStep('Teams', '[data-tour="teams"]', 'bottom', 'end'),
    namedStep('Export', '[data-tour="export"]', 'bottom', 'end'),
    namedStep('Help', '[data-tour="help"]', 'bottom', 'end'),
  ];
}

/**
 * 熱鍵輸入模式導覽的步驟（2 步）。
 *   hk1：聚焦泳道區（不含下方空白），示範模式內鍵盤/滑鼠輸入。
 *   hk2：無 spotlight（以 .app-layout 當全景），示範開設定 → 進對映表編輯。
 */
function buildHotkeySteps(): DriveStep[] {
  const step = (key: 'Hk1' | 'Hk2', element: string | Element, side: PopoverSide): DriveStep => ({
    element,
    popover: {
      title: t(`tour.step${key}Title`),
      description: t(`tour.step${key}Desc`),
      side,
      align: 'center',
    },
    onHighlighted: () => resetDemoBoard(),
  });
  return [
    // hk1 高亮「代理框」而非 .board__lanes：示範插入會水平捲動軸面，
    // 直接高亮泳道容器會讓聚光燈框跟著捲；代理框固定在可視範圍不動。
    { ...step('Hk1', hotkeyLaneProxy(), 'bottom'), onHighlighted: () => { resetDemoBoard(); runDemo('hk1'); } },
    { ...step('Hk2', '.app-layout', 'top'), onHighlighted: () => { resetDemoBoard(); runDemo('hk2'); } },
  ];
}

// ── Spotlight 邊框環（掛在 body，避開 overflow 裁切）─────────────────
// 高亮元素的 box-shadow 光暈會被 .rotation-board/.board__scroll 等 overflow:hidden
// 祖先裁切、也被暗遮罩(z-index 10000)蓋住。改用獨立 fixed 元素畫發光框，
// 以 rAF 每幀跟隨 .driver-active-element 的實際位置（含 demo 中尺寸變動）。
let stageRing: HTMLElement | null = null;
let ringRaf = 0;
function startStageRing(): void {
  if (!stageRing) {
    stageRing = document.createElement('div');
    stageRing.className = 'tour-stage-ring';
    document.body.appendChild(stageRing);
  }
  const pad = 6; // 對齊 driver stagePadding
  const tick = (): void => {
    const el = document.querySelector('.driver-active-element');
    if (el) {
      const r = el.getBoundingClientRect();
      const s = stageRing!.style;
      s.opacity = '1';
      s.left = `${r.left - pad}px`;
      s.top = `${r.top - pad}px`;
      s.width = `${r.width + pad * 2}px`;
      s.height = `${r.height + pad * 2}px`;
    } else if (stageRing) {
      stageRing.style.opacity = '0';
    }
    ringRaf = requestAnimationFrame(tick);
  };
  ringRaf = requestAnimationFrame(tick);
}
function stopStageRing(): void {
  if (ringRaf) cancelAnimationFrame(ringRaf);
  ringRaf = 0;
  stageRing?.remove();
  stageRing = null;
}

/** capture-phase 鍵盤攔截：A/D 導覽上一步/下一步（不論焦點，含示範輸入框）；
 *  其餘實體按鍵一律攔下（純觀看，避免在 n3/n5 的輸入框打字、Delete、Ctrl+Z 等污染版面）。 */
function onTourKeydown(event: KeyboardEvent): void {
  if (!isActive.value || !driverObj) return;
  // demo 自己派發的合成鍵盤事件（isTrusted=false，如 step3/5 的 Enter 提交）放行。
  if (!event.isTrusted) return;
  // ESC 交給 driver 處理關閉，不攔。
  if (event.key === 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const key = event.key.toLowerCase();
  if (key === 'd' || key === 'arrowright') driverObj.moveNext();
  // 第一步再往前會被 driver 視為關閉導覽 → 首步時忽略「上一步」。
  else if ((key === 'a' || key === 'arrowleft') && (driverObj.getActiveIndex() ?? 0) > 0) driverObj.movePrevious();
}

/** 導覽期間任何輸入框一聚焦立即設唯讀：堵住示範輸入框出現到 readOnly 補設前的空窗，
 *  連 IME 組字（insertCompositionText 不可取消、繞過 keydown preventDefault）也進不了字；
 *  demo 以程式設 value + 派發 input 事件驅動，不受 readOnly 影響。 */
function onTourFocusIn(event: FocusEvent): void {
  if (!isActive.value) return;
  const t = event.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) t.readOnly = true;
}

/** capture-phase 攔掉導覽期間的實體輸入類事件（貼上/輸入/剪下/拖放），防止污染示範版面。 */
function onTourBlockInput(event: Event): void {
  if (!isActive.value) return;
  if (event.isTrusted) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
const TOUR_BLOCK_EVENTS = ['paste', 'beforeinput', 'cut', 'drop'];

/** driver 於完成/關閉/Esc 統一呼叫：卸監聽、取消示範、還原版面、收尾。 */
function handleDestroyed(): void {
  window.removeEventListener('keydown', onTourKeydown, true);
  window.removeEventListener('focusin', onTourFocusIn, true);
  TOUR_BLOCK_EVENTS.forEach((e) => window.removeEventListener(e, onTourBlockInput, true));
  document.body.classList.remove('tour-active');
  stopStageRing();
  setTourApi(null);
  suppressCancel = false;
  // 統一從單一入口收拾所有暫態並還原（狀態切片 + 持久化 + UI 暫態 + 模式）。
  exitSandbox();
  isActive.value = false;
  driverObj = null;
}

export function useSpotlightTour() {
  async function begin(v: TourVariant): Promise<void> {
    if (isActive.value) {
      // driver 仍在 → 真的進行中，忽略重複啟動。
      if (driverObj) return;
      // 否則為孤兒狀態（上一輪未經 onDestroyed 收尾）：先復位再重啟，
      // 避免 isActive 卡 true 使導覽永遠無法再開。
      handleDestroyed();
    }
    variant = v;

    // 動態載入 driver.js 本體與其樣式（首屏不含）。await 期間尚未改動版面，
    // 使用者最多感覺到首次開導覽的極短延遲（chunk 通常已被瀏覽器快取）。
    const { driver } = await import('driver.js');
    await import('driver.js/dist/driver.css');

    // 進入導覽沙盒：暫停持久化（避免示範資料覆蓋模板庫／熱鍵對映表落地）+ 擷取
    // UI 暫態快照（側欄收合 + 作用中分頁）。須早於任何示範注入與側欄收合，
    // 故置於變體分支之前（尤其熱鍵變體稍後會收合側欄）。exitSandbox 時反向還原。
    enterSandbox();

    // 熱鍵導覽：若使用者已在模式中（首次進入觸發路徑）先退出，
    // 讓 hk1 的示範統一走「主動進入模式」的乾淨路徑。
    if (variant === 'hotkey') useHotkeyInputMode().exit();

    // 熱鍵導覽的示範資料延後注入（見下方 hotkey 分支）：注入會改變 scrollWidth，
    // 必須等側欄收合定型後與瞬間置中同幀完成，否則會先看到夾回/位移。
    if (variant === 'main') injectDemo();
    const sidebar = useSidebarCollapse();
    if (variant === 'main') {
      // 側邊欄若原本收合，導覽期間強制展開（step2/4 需要可見的側邊欄）；結束時還原。
      sidebar.collapsed.value = false;
      hasSeenTour.value = true;
      persistSeen(STORAGE_KEY);
    } else {
      // 熱鍵導覽的側欄由模式自己收合/還原；此處只記首訪旗標。
      hasSeenHotkeyTour.value = true;
      persistSeen(HOTKEY_STORAGE_KEY);
    }
    isActive.value = true;
    // 導覽期間旗標：抬升被 Teleport 的真實 UI（角色下拉、確認框）與示範指標
    // 的 z-index，使其顯示於 driver 遮罩（z-index 1e9）之上。
    document.body.classList.add('tour-active');
    startStageRing();

    driverObj = driver({
      showProgress: true,
      allowClose: true,
      // 關閉遮罩過場動畫：driver 於過場（預設 400ms）進行中會忽略 moveNext/movePrevious
      // （內部 __transitionCallback 守衛），且 demo 的 refocus(highlight) 也會觸發過場，
      // 導致快速切步驟時 spotlight 卡在半途/上一步。改為瞬間定位，切步驟即時、不殘留。
      animate: false,
      // 點遮罩空白處「不做任何事」：導覽為純觀看，避免使用者誤點空白中斷示範。
      // driver 執行期支援傳入函式（no-op）；ESC／關閉鈕／完成鈕仍可正常結束（allowClose 維持 true）。
      overlayClickBehavior: (() => {}) as unknown as 'close',
      // 導覽為純觀看：鎖住 spotlight 內元件的互動（示範效果由程式驅動，
      // 不依賴真實 DOM 事件），避免使用者誤操作示範版面。
      disableActiveInteraction: true,
      // 加大挖空留白，讓高亮框更明顯。
      stagePadding: 6,
      stageRadius: 8,
      // 遮罩更深，凸顯 spotlight。
      overlayColor: 'rgba(3, 6, 14, 0.86)',
      popoverClass: 'tour-popover',
      // 於按鈕標示鍵盤快捷鍵，讓使用者知道可用 A/D 導覽上一步/下一步。
      nextBtnText: `${t('tour.next')} (D)`,
      prevBtnText: `${t('tour.prev')} (A)`,
      doneBtnText: t('tour.done'),
      progressText: '{{current}} / {{total}}',
      steps: variant === 'hotkey' ? buildHotkeySteps() : buildSteps(),
      // 離開任一步（切上一步/下一步）即取消正在播放的示範動畫；
      // 但 refocus 用 highlight 移動焦點時的內部 deselect 不算，故看 suppressCancel。
      onDeselected: () => { if (!suppressCancel) cancelDemo(); },
      onDestroyed: handleDestroyed,
    });

    // 提供 demo 中途移動 spotlight 焦點、重算遮罩的能力（如步驟 2/5）。
    setTourApi({ refocus, refresh: () => driverObj?.refresh() });
    window.addEventListener('keydown', onTourKeydown, true);
    window.addEventListener('focusin', onTourFocusIn, true);
    TOUR_BLOCK_EVENTS.forEach((e) => window.addEventListener(e, onTourBlockInput, true));

    if (variant === 'hotkey') {
      // 熱鍵導覽 step 1 的進場順序（防抖動的關鍵）：
      //   1) 先「只收合側欄」——畫面上仍是使用者自己的軸面，配一段正常的收合過渡。
      //   2) 等版面定型後，才在「同一幀」內：注入示範資料 → 進入模式 → 瞬間置中
      //      幽靈格 → 重算代理框 → drive。注入造成的 scrollWidth 縮短（夾回）與
      //      置中在首繪前一次到位，量測也都以「最終版面」為準——不會先看到
      //      尾端區塊貼左緣、再整片猛移，spotlight 也不跳位。
      //   （若側欄本就收合，無過渡可等 → 延遲 0 立即進行。）
      const needCollapse = !sidebar.collapsed.value;
      sidebar.collapsed.value = true;
      window.setTimeout(() => {
        if (!isActive.value || !driverObj) return;
        injectDemo();
        // 側欄已收合 → enter() 內的收合為 no-op、無新過渡；其 300ms 後的平滑置中
        // 與下方瞬間置中目標相同，僅作保險校正（距離≈0，看不出移動）。
        useHotkeyInputMode().enter();
        void nextTick(() => {
          if (!isActive.value || !driverObj) return;
          const ghost = document.querySelector<HTMLElement>('.track__ghost-cell');
          const scroll = document.querySelector<HTMLElement>('.board__scroll');
          if (ghost && scroll) {
            scroll.scrollLeft = computeCenterScrollLeft(ghost, scroll, 'viewport');
          }
          syncHotkeyLaneProxy(); // 以收合後的可視泳道範圍重算代理框
          driverObj.drive(); // onHighlighted → runDemo('hk1')
        });
      }, needCollapse ? HOTKEY_LAYOUT_SETTLE_MS : 0);
    } else {
      // 等示範資料渲染出泳道/區塊元件後再啟動定位。
      nextTick(() => driverObj?.drive());
    }
  }

  /** 主導覽（首訪 12 步）。 */
  function start(): Promise<void> {
    return begin('main');
  }

  /** 熱鍵輸入模式導覽（2 步；首次進入模式或幫助中心重播）。 */
  function startHotkeyTour(): Promise<void> {
    return begin('hotkey');
  }

  return { isActive, hasSeenTour, hasSeenHotkeyTour, start, startHotkeyTour };
}

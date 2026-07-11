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
import { driver, type Driver, type DriveStep } from 'driver.js';
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
import { runDemo, cancelDemo, setTourApi } from '@/composables/state/useTourDemo';
import type { CharacterSlots, SlotIndex } from '@/types/character';
import type { RotationAxis, RotationEntry } from '@/types/rotation';
import type { InstanceBlock, TemplateBlock } from '@/types/block';

const STORAGE_KEY = 'wuwa-rotation-tour-seen';

function loadSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
function persistSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch (e) {
    console.warn('[useSpotlightTour] 首訪旗標寫入失敗', e);
  }
}

// ── module 單例狀態 ─────────────────────────────────────────
const isActive = ref(false);
const hasSeenTour = ref(loadSeen());
let driverObj: Driver | null = null;
// 抑制旗標：demo 內用 driver.highlight 移動焦點時，driver 會內部觸發 onDeselected，
// 若不抑制會誤把正在播放的 demo 取消。refocus 期間暫設 true。
let suppressCancel = false;
// 導覽開始前的側邊欄收合狀態；導覽期間強制展開（step2/4 需要側邊欄），結束時還原。
let sidebarWasCollapsed = false;

/** 把 spotlight 焦點移到選擇器指向的元件，保留當前步驟氣泡（供 demo 中途換焦點）。 */
function refocus(selector: string): void {
  if (!driverObj) return;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  const steps = buildSteps();
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

/** 導覽開始前的版面快照（結束時還原）。 */
interface BoardSnapshot {
  slots: CharacterSlots;
  axes: RotationAxis[];
  activeAxisId: string;
  laneOrder: SlotIndex[];
  templates: TemplateBlock[];
  history: ReturnType<ReturnType<typeof useHistory>['snapshotStacks']>;
}
let snapshot: BoardSnapshot | null = null;
/** 示範版面基準（供每次示範動畫重設，確保可重複播放）。 */
let demoBaseline: { slots: CharacterSlots; axis: RotationAxis } | null = null;

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
  const templateStore = useTemplateStore();
  const { laneOrder } = useLaneOrder();

  snapshot = {
    slots: deepClone(characterStore.slots),
    axes: deepClone(rotationStore.axes),
    activeAxisId: rotationStore.activeAxisId,
    laneOrder: deepClone(laneOrder.value),
    templates: deepClone(templateStore.templates),
    history: useHistory().snapshotStacks(),
  };

  const { slots, axis } = buildDemo();
  demoBaseline = { slots: deepClone(slots), axis: deepClone(axis) };
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

  characterStore.slots = deepClone(demoBaseline.slots);
  rotationStore.axes = [deepClone(demoBaseline.axis)];
  rotationStore.activeAxisId = rotationStore.axes[0].id;
  // 示範期間模板庫清空：避免使用者既有同名模板使「存模板」被去重略過，
  // 也讓示範新增的 chip 一定是清單裡唯一/最後一個。結束時 restore 還原。
  templateStore.templates = [];
  rotationStore.clearSelection();
  rotationStore.stopEditing();
}

/** 還原導覽開始前的版面。 */
function restore(): void {
  if (!snapshot) return;
  const rotationStore = useRotationStore();
  const characterStore = useCharacterStore();
  const templateStore = useTemplateStore();
  const { laneOrder } = useLaneOrder();

  characterStore.slots = deepClone(snapshot.slots);
  rotationStore.axes = deepClone(snapshot.axes);
  rotationStore.activeAxisId = snapshot.activeAxisId;
  laneOrder.value = deepClone(snapshot.laneOrder);
  templateStore.templates = deepClone(snapshot.templates);
  // 還原 undo/redo 佇列，清掉示範真實動作造成的歷史污染。
  useHistory().restoreStacks(snapshot.history);
  rotationStore.clearSelection();
  rotationStore.stopEditing();
  snapshot = null;
  demoBaseline = null;
}

/** 切換側邊欄分頁（步驟 2/5 進場時呼叫）。 */
function clickTab(id: 'tab-general' | 'tab-custom'): void {
  (document.getElementById(id) as HTMLElement | null)?.click();
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
    { ...step(1, '[data-tour="lane-header"]', 'right'), onHighlighted: () => { resetDemoBoard(); runDemo(1); } },
    {
      ...step(2, '.app-layout', 'top', 'center'),
      onHighlightStarted: () => clickTab('tab-general'),
      onHighlighted: () => { resetDemoBoard(); runDemo(2); },
    },
    { ...step(3, '[data-slot-index="0"]', 'left', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(3); } },
    {
      ...step(4, '.sidebar-panel', 'right', 'center'),
      // 進場停在「通用」頁；切到「自訂」由 demo 內點擊分頁的動作負責。
      onHighlightStarted: () => clickTab('tab-general'),
      onHighlighted: () => { resetDemoBoard(); runDemo(4); },
    },
    { ...step(5, '[data-slot-index="0"]', 'left', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(5); } },
    { ...step(6, '.board__lanes', 'top', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(6); } },
    { ...step(7, '.rotation-board', 'top', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(7); } },
    { ...step(8, '.board__lanes', 'top', 'center'), onHighlighted: () => { resetDemoBoard(); runDemo(8); } },
    step(9, '.axis-tabbar', 'top', 'center'),
    // ── 收尾三步（固定掛最末端；未來新步驟插在本行之前）──
    namedStep('Teams', '[data-tour="teams"]', 'bottom', 'end'),
    namedStep('Export', '[data-tour="export"]', 'bottom', 'end'),
    namedStep('Help', '[data-tour="help"]', 'bottom', 'end'),
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

/** capture-phase 鍵盤攔截：A/D 導覽上一步/下一步；其餘實體按鍵一律攔下（純觀看）。 */
function onTourKeydown(event: KeyboardEvent): void {
  if (!isActive.value || !driverObj) return;
  // demo 自己派發的合成鍵盤事件（isTrusted=false，如 step3/5 的 Enter 提交）放行。
  if (!event.isTrusted) return;
  const key = event.key.toLowerCase();
  if (key === 'd') {
    event.preventDefault();
    event.stopImmediatePropagation();
    driverObj.moveNext();
    return;
  }
  if (key === 'a') {
    event.preventDefault();
    event.stopImmediatePropagation();
    // 第一步再往前會被 driver 視為關閉導覽 → 首步時忽略「上一步」。
    if ((driverObj.getActiveIndex() ?? 0) > 0) driverObj.movePrevious();
    return;
  }
  // ESC 交給 driver 處理關閉，不攔。
  if (event.key === 'Escape') return;
  // 其餘實體按鍵一律攔截：導覽為純觀看，避免污染示範版面
  // （在 step3/5 的輸入框打字、Delete 刪除、Ctrl+Z/A/C/V、Tab 收合側邊欄等）。
  event.preventDefault();
  event.stopImmediatePropagation();
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
  TOUR_BLOCK_EVENTS.forEach((e) => window.removeEventListener(e, onTourBlockInput, true));
  document.body.classList.remove('tour-active');
  stopStageRing();
  setTourApi(null);
  suppressCancel = false;
  cancelDemo();
  restore();
  // 還原導覽開始前的側邊欄收合狀態。
  useSidebarCollapse().collapsed.value = sidebarWasCollapsed;
  isActive.value = false;
  driverObj = null;
}

export function useSpotlightTour() {
  function start(): void {
    if (isActive.value) {
      // driver 仍在 → 真的進行中，忽略重複啟動。
      if (driverObj) return;
      // 否則為孤兒狀態（上一輪未經 onDestroyed 收尾）：先復位再重啟，
      // 避免 isActive 卡 true 使導覽永遠無法再開。
      handleDestroyed();
    }

    injectDemo();
    // 側邊欄若原本收合，導覽期間強制展開（step2/4 需要可見的側邊欄）；結束時還原。
    const sidebar = useSidebarCollapse();
    sidebarWasCollapsed = sidebar.collapsed.value;
    sidebar.collapsed.value = false;
    hasSeenTour.value = true;
    persistSeen();
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
      steps: buildSteps(),
      // 離開任一步（切上一步/下一步）即取消正在播放的示範動畫；
      // 但 refocus 用 highlight 移動焦點時的內部 deselect 不算，故看 suppressCancel。
      onDeselected: () => { if (!suppressCancel) cancelDemo(); },
      onDestroyed: handleDestroyed,
    });

    // 提供 demo 中途移動 spotlight 焦點、重算遮罩的能力（如步驟 2/5）。
    setTourApi({ refocus, refresh: () => driverObj?.refresh() });
    window.addEventListener('keydown', onTourKeydown, true);
    TOUR_BLOCK_EVENTS.forEach((e) => window.addEventListener(e, onTourBlockInput, true));
    // 等示範資料渲染出泳道/區塊元件後再啟動定位。
    nextTick(() => driverObj?.drive());
  }

  return { isActive, hasSeenTour, start };
}

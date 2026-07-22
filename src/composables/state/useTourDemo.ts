// ============================================================
// useTourDemo.ts — 導覽示範動畫引擎（虛擬指標 + App 原生真實效果）。
//
// 原則：
//   - 效果一律走 App「真實互動」：以程式對真實元件派發 click/scroll 等，
//     觸發原生下拉、確認框、換角等；不做假的視覺模擬。
//   - 指標（tour-cursor）僅為視覺提示，指向正在操作的元件；漣漪標示點擊。
//   - 版面重設、歷史/狀態還原由 useSpotlightTour 負責；本檔只演操作。
//   - 以遞增 runToken 實作取消：primitives 每次檢查 token，過期即拋出中止。
//   - 步驟腳本見檔末 DEMOS（主導覽 1~8 步各一支 demoStepN；
//     熱鍵模式導覽 'hk1'/'hk2' 各一支 demoHotkeyN）。
// ============================================================

import { CHARACTER_MAP } from '@/constants/characters';
import { characterDisplayName, t } from '@/i18n';
import { useBlockNavigation } from '@/composables/board/useBlockNavigation';
import { useRotationStore } from '@/stores/useRotationStore';
import { useHotkeyInputMode } from '@/composables/state/useHotkeyInputMode';
import { useHotkeyMapDialog } from '@/composables/state/useHotkeyMapDialog';

/** 導覽對外能力（由 useSpotlightTour 注入）：目前提供「移動 spotlight 焦點」。 */
export interface TourApi {
  /** 把 driver 高亮移到選擇器指向的元件（保留當前步驟的氣泡）。 */
  refocus: (selector: string) => void;
  /** 重新量測當前高亮元素、重畫遮罩挖空（元素尺寸變動後同步 spotlight）。 */
  refresh: () => void;
}
let tourApi: TourApi | null = null;
export function setTourApi(api: TourApi | null): void {
  tourApi = api;
}

let cursorEl: HTMLElement | null = null;
let runToken = 0;
// 進行中真實拖曳的「同步非提交式中止」入口（由 realDrag 設定，cancelDemo 呼叫）。
let abortDrag: (() => void) | null = null;

class CancelledError extends Error {}

function ensureCursor(): HTMLElement {
  if (cursorEl) return cursorEl;
  const el = document.createElement('div');
  el.className = 'tour-cursor';
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
    '<path d="M5 2.5l14 8.4-6.1 1.2 3.4 6.9-2.7 1.3-3.4-6.9-4.6 4.2z" ' +
    'fill="#0a0f1e" stroke="#22d3ee" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(el);
  cursorEl = el;
  return el;
}

function checkToken(token: number): void {
  if (token !== runToken) throw new CancelledError();
}

function sleep(ms: number, token: number): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => (token === runToken ? resolve() : reject(new CancelledError())), ms);
  });
}

interface Pt { x: number; y: number }

function centerOf(target: string | Element | null): Pt | null {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function showCursor(): void {
  ensureCursor().style.opacity = '1';
}
function hideCursor(): void {
  if (cursorEl) cursorEl.style.opacity = '0';
}

/** 瞬移指標（不帶過場），設定起點用。 */
function cursorInstant(x: number, y: number): void {
  const el = ensureCursor();
  el.style.transition = 'none';
  el.style.transform = `translate(${x}px, ${y}px)`;
  void el.offsetWidth; // 強制 reflow，讓後續 transition 生效
}

/** 平滑移動指標到 (x,y)，耗時 dur。 */
async function moveTo(x: number, y: number, dur: number, token: number): Promise<void> {
  checkToken(token);
  const el = ensureCursor();
  el.style.transition = `transform ${dur}ms cubic-bezier(0.45, 0, 0.2, 1), opacity 0.2s ease`;
  el.style.transform = `translate(${x}px, ${y}px)`;
  await sleep(dur, token);
}

/** 指標「出場」：先瞬移到 p 左下偏移處再顯示、滑入 p。切步驟時舊指標已被
 *  cancelDemo 隱藏，出場前不 showCursor，避免殘留上一步位置的指標。 */
async function cursorEnter(p: Pt, dur: number, token: number): Promise<void> {
  cursorInstant(p.x - 40, p.y + 34);
  showCursor();
  await moveTo(p.x, p.y, dur, token);
}

async function moveToEl(target: string | Element | null, dur: number, token: number): Promise<Pt | null> {
  const p = centerOf(target);
  if (!p) return null;
  await moveTo(p.x, p.y, dur, token);
  return p;
}

/** 點擊回饋：指標按壓 + 漣漪。 */
function clickFx(p: Pt): void {
  const el = ensureCursor();
  el.classList.add('tour-cursor--press');
  setTimeout(() => el.classList.remove('tour-cursor--press'), 180);
  const rip = document.createElement('div');
  rip.className = 'tour-ripple';
  rip.style.left = `${p.x}px`;
  rip.style.top = `${p.y}px`;
  document.body.appendChild(rip);
  setTimeout(() => rip.remove(), 620);
}

// ── 熱鍵導覽 hk1 的 spotlight 代理框 ─────────────────────────
// 高亮 .board__lanes 會隨軸面水平捲動/變寬而位移，聚光燈框看起來跟著捲。
// 改高亮一個 fixed 定位的代理元素：矩形＝泳道區與捲動視口的交集（可視範圍），
// 示範插入造成的捲動不再帶動聚光燈框。
let laneProxyEl: HTMLElement | null = null;

/** 依當前版面重算代理框矩形（模式進入側欄收合定型後、或版面變動時呼叫）。 */
export function syncHotkeyLaneProxy(): void {
  if (!laneProxyEl) return;
  const lanes = document.querySelector('.board__lanes');
  if (!lanes) return;
  const lr = lanes.getBoundingClientRect();
  const sr = document.querySelector('.board__scroll')?.getBoundingClientRect() ?? lr;
  const left = Math.max(lr.left, sr.left);
  const right = Math.min(lr.right, sr.right);
  const s = laneProxyEl.style;
  s.left = `${left}px`;
  s.top = `${lr.top}px`;
  s.width = `${Math.max(0, right - left)}px`;
  s.height = `${lr.height}px`;
}

/** 取得（必要時建立）代理框元素，回傳前先同步矩形。供 buildHotkeySteps 當高亮目標。 */
export function hotkeyLaneProxy(): HTMLElement {
  if (!laneProxyEl) {
    laneProxyEl = document.createElement('div');
    laneProxyEl.className = 'tour-lane-proxy';
    document.body.appendChild(laneProxyEl);
  }
  syncHotkeyLaneProxy();
  return laneProxyEl;
}

/** 移除代理框（導覽收尾呼叫；步驟間不可移除——driver 仍持有其參照）。 */
export function removeHotkeyLaneProxy(): void {
  laneProxyEl?.remove();
  laneProxyEl = null;
}

// ── 鍵帽視覺（熱鍵模式導覽用）：畫面上彈出「按了哪顆鍵」的大鍵帽 ──
let keycapEl: HTMLElement | null = null;
let keycapFadeTimer: number | null = null;
function ensureKeycap(): HTMLElement {
  if (keycapEl) return keycapEl;
  const el = document.createElement('div');
  el.className = 'tour-keycap';
  document.body.appendChild(el);
  keycapEl = el;
  return el;
}

/** 顯示鍵帽（按下態）：固定顯示在幽靈格（下一個落點）右上角，
 *  與「輸入會落在哪」的視覺焦點綁在一起；連續按同鍵時重觸發按壓動畫。 */
function keycapDown(label: string): void {
  const el = ensureKeycap();
  if (keycapFadeTimer !== null) {
    clearTimeout(keycapFadeTimer);
    keycapFadeTimer = null;
  }
  const anchor = document.querySelector('.track__ghost-cell') ?? document.querySelector('.board__lanes');
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    // 右上角外側偏移；夾在視窗內避免貼近右緣時被裁切。
    el.style.left = `${Math.min(r.right + 10, window.innerWidth - 72)}px`;
    el.style.top = `${Math.max(r.top - 6, 48)}px`;
  }
  el.textContent = label;
  el.classList.remove('tour-keycap--press');
  void el.offsetWidth; // 強制 reflow：同鍵連按也重播按壓動畫
  el.classList.add('tour-keycap--press');
  el.style.opacity = '1';
}

/** 鍵帽放開：解除按下態，停留片刻再淡出（太快消失會看不清按了什麼）。 */
function keycapUp(): void {
  if (!keycapEl) return;
  keycapEl.classList.remove('tour-keycap--press');
  if (keycapFadeTimer !== null) clearTimeout(keycapFadeTimer);
  keycapFadeTimer = window.setTimeout(() => {
    keycapFadeTimer = null;
    if (keycapEl) keycapEl.style.opacity = '0';
  }, 400);
}

/** 對 body 派發合成鍵盤事件（isTrusted=false 穿過導覽攔截；帶 code 供模式比對物理鍵）。 */
function fireModeKey(type: 'keydown' | 'keyup', code: string, key: string): void {
  document.body.dispatchEvent(
    new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }),
  );
}

/** 單擊一顆模式熱鍵：keydown → 短暫按住（<300ms 判 tap）→ keyup 落子；鍵帽同步顯示。 */
async function tapModeKey(code: string, key: string, capLabel: string, token: number): Promise<void> {
  checkToken(token);
  // 先派發 keydown 再定位鍵帽：切泳道鍵（1/2/3）按下即移動幽靈格，
  // 鍵帽才能錨定在「新」落點的右上角。
  fireModeKey('keydown', code, key);
  await sleep(30, token); // 等 Vue 重繪（幽靈格若因切泳道移動，鍵帽才錨得到新位置）
  keycapDown(capLabel);
  await sleep(120, token);
  fireModeKey('keyup', code, key);
  keycapUp();
}

/** 長按一顆模式熱鍵：按住 holdMs（≥300ms 判 hold）再放開；鍵帽維持按下態。 */
async function holdModeKey(code: string, key: string, capLabel: string, holdMs: number, token: number): Promise<void> {
  checkToken(token);
  fireModeKey('keydown', code, key); // 先 keydown 再定位鍵帽（同 tapModeKey，跟上幽靈格切泳道）
  try {
    await sleep(30, token); // 等 Vue 重繪幽靈格新位置
    keycapDown(capLabel);
    await sleep(holdMs - 30, token);
  } finally {
    fireModeKey('keyup', code, key); // 取消時也放開，避免模式殘留按壓計時
    keycapUp();
  }
}

/** 緩動捲動列表容器，使 target 逼近垂直置中（真實 scroll，不關閉下拉）。 */
async function scrollListboxTo(container: HTMLElement, target: HTMLElement, token: number): Promise<void> {
  for (let i = 0; i < 16; i++) {
    checkToken(token);
    const c = container.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const delta = (t.top + t.height / 2) - (c.top + c.height / 2);
    if (Math.abs(delta) < 4) break;
    container.scrollTop += delta * 0.35;
    await sleep(55, token);
  }
}

/** rAF 逐幀平滑捲動容器，使 target 逼近垂直置中（easeInOutQuad）。
 *  取代 scrollListboxTo 的逐段跳動（55ms 一跳會顯得卡頓），用於設定面板等長捲動。 */
function smoothScrollTo(container: HTMLElement, target: HTMLElement, dur: number, token: number): Promise<void> {
  const c = container.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  const from = container.scrollTop;
  const to = Math.max(0, from + (t.top + t.height / 2) - (c.top + c.height / 2));
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    function frame(now: number): void {
      if (token !== runToken) return reject(new CancelledError());
      const p = Math.min(1, (now - t0) / dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      container.scrollTop = from + (to - from) * e;
      if (p < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

/** 逐字輸入到行內編輯框：每字設 value 並派發 input 事件（驅動 Vue v-model 與寬度重算），
 *  隨後重畫 spotlight 遮罩（區塊變寬時遮罩才跟上）。 */
async function typeInto(input: HTMLInputElement, text: string, token: number): Promise<void> {
  input.focus();
  for (let i = 1; i <= text.length; i++) {
    checkToken(token);
    input.value = text.slice(0, i);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(60, token); // 等 Vue 依草稿重算欄寬渲染，再重畫遮罩
    tourApi?.refresh();
    await sleep(110, token);
  }
}

// ──────────────────────────────────────────────────────────
// 步驟腳本
// ──────────────────────────────────────────────────────────

/**
 * 步驟 n1：選角與取消選角（c3 泳道）。
 *   1) 指標移到 c3（愛彌斯）頭像、略停 hover，點擊開下拉；
 *      捲動找到「莫寧(Mornye)」→ 點選 → 確認換角（清空區塊）。
 *   2) 指標移到莫寧 header 的「取消選角」鈕並點擊 → 泳道回到未選角。
 */
async function demoStep1(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染
  const header = document.querySelector('[data-tour="lane-header"]') as HTMLElement | null;
  if (!header) return;

  // 1) 指標移到頭像、略停 hover，直接點擊開下拉
  const frame = header.querySelector('.header__portrait-frame');
  const ap = frame ? centerOf(frame) : null;
  if (ap) {
    await cursorEnter(ap, 800, token);
    await sleep(650, token); // 略停 hover
    clickFx(ap);
  }
  (header.querySelector('.char-selector__trigger') as HTMLElement | null)?.click();
  await sleep(900, token);

  // 找「莫寧」選項（與愛彌斯同屬熱熔，開啟即在同一 tab，捲動即可）
  const wantName = characterDisplayName(CHARACTER_MAP['mornye']);
  const listbox = document.querySelector('.char-selector__listbox') as HTMLElement | null;
  const findOpt = (): HTMLElement | undefined =>
    [...(listbox?.querySelectorAll<HTMLElement>('.char-selector__option') ?? [])].find(
      (li) => li.querySelector('.char-selector__option-name')?.textContent?.trim() === wantName,
    );

  let opt = findOpt();
  if (listbox && opt) await scrollListboxTo(listbox, opt, token);
  opt = findOpt();
  if (opt) {
    opt.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); // 高亮該選項
    const p = centerOf(opt);
    if (p) {
      await moveTo(p.x, p.y, 700, token);
      await sleep(350, token);
      clickFx(p);
    }
    opt.click(); // 真實選取 → 觸發「換角將清空區塊」確認框
  }
  await sleep(950, token);

  // 4) 確認框：指標移到「確定」鈕並點擊，完成換角
  const confirmBtn = document.querySelector('.dialog__btn--confirm') as HTMLElement | null;
  if (confirmBtn) {
    const p = await moveToEl(confirmBtn, 700, token);
    if (p) {
      await sleep(350, token);
      clickFx(p);
    }
    confirmBtn.click();
  }
  await sleep(1400, token);

  // 2) 取消選角：右下角鈕靠 CSS :hover 浮現（合成事件無法觸發），
  //    改以 inline opacity 強制顯示；點擊後泳道清空，鈕隨 v-if 移除。
  const deselect = header.querySelector('.header__deselect') as HTMLElement | null;
  if (!deselect) return;
  deselect.style.opacity = '1';
  const dp = await moveToEl(deselect, 800, token);
  if (dp) {
    await sleep(450, token);
    clickFx(dp);
  }
  deselect.click(); // 換角後泳道已無區塊 → 不會跳確認框，直接回未選角
  await sleep(1400, token);
}

/** 對元件派發一顆 pointer + mouse 事件（SortableJS 用 pointer，App 落點預覽用 mouse）。 */
function fireDrag(el: EventTarget, type: 'down' | 'move' | 'up', x: number, y: number): void {
  const common = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
  const buttons = type === 'up' ? 0 : 1;
  const pType = type === 'down' ? 'pointerdown' : type === 'move' ? 'pointermove' : 'pointerup';
  const mType = type === 'down' ? 'mousedown' : type === 'move' ? 'mousemove' : 'mouseup';
  el.dispatchEvent(new PointerEvent(pType, { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons }));
  el.dispatchEvent(new MouseEvent(mType, { ...common, button: 0, buttons }));
}

/**
 * rAF 逐幀指標內插：以 ~60fps 從 start 平滑移到 target，指標直接設 transform
 * （不用逐段 CSS transition，避免段段緩動造成的頓挫）。onFrame 於每幀以當前座標
 * 呼叫，供派發拖曳/框選事件。easeInOutQuad：起訖略緩、中段順暢，貼近真人手感。
 */
function animateCursor(
  start: Pt,
  target: Pt,
  dur: number,
  token: number,
  onFrame?: (x: number, y: number) => void,
): Promise<void> {
  const el = ensureCursor();
  el.style.transition = 'none';
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    function frame(now: number): void {
      if (token !== runToken) return reject(new CancelledError());
      const p = Math.min(1, (now - t0) / dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const x = start.x + (target.x - start.x) * e;
      const y = start.y + (target.y - start.y) * e;
      onFrame?.(x, y);
      el.style.transform = `translate(${x}px, ${y}px)`;
      if (p < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

/** 逐幀拖曳：每幀在座標下的真實元素派發 move 事件（使 App 的 event.target 落在泳道內）。 */
function animateDrag(start: Pt, target: Pt, dur: number, token: number): Promise<void> {
  return animateCursor(start, target, dur, token, (x, y) => {
    const overEl = document.elementFromPoint(x, y) ?? document;
    fireDrag(overEl, 'move', x, y);
  });
}

/**
 * 真實拖曳：對來源元件派發 pointer/mouse 事件序列，觸發 SortableJS forceFallback
 * 與 App 的落點預覽，把元件放到 target 點。導覽遮罩 pointer-events 暫關，
 * 讓 App 的 elementFromPoint 能穿透遮罩取到底下真實泳道。指標同步跟隨。
 */
async function realDrag(sourceEl: HTMLElement, target: Pt, token: number, hold = 280): Promise<void> {
  // 拖曳期間關閉會擋住 elementFromPoint 的 driver 遮罩與氣泡，並讓排軸板可命中。
  const blockers = [
    document.querySelector('svg.driver-overlay'),
    document.querySelector('.driver-popover'),
  ].filter((el): el is HTMLElement => el instanceof HTMLElement);
  const savedPE = blockers.map((el) => el.style.pointerEvents);
  blockers.forEach((el) => (el.style.pointerEvents = 'none'));
  document.body.classList.add('tour-dragging');
  // 拖曳期間攔掉使用者「真實」滑鼠事件（isTrusted），避免 SortableJS forceFallback
  // 同時被真實游標移動牽引，使分身在合成落點與真實游標間反覆跳動（控制權衝突）。
  // 我們自己派發的合成事件 isTrusted=false，照常放行。window capture 為最外層，
  // stopImmediatePropagation 能在事件抵達 document 上的 SortableJS 監聽前攔下。
  const swallowReal = (e: Event): void => {
    if (e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); }
  };
  const REAL_EVENTS = ['pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'];
  REAL_EVENTS.forEach((t) => window.addEventListener(t, swallowReal, true));
  let downFired = false;
  let upFired = false;
  let cleaned = false;
  // 送出放開事件（在座標下真實元素派發，冒泡到 document 讓 SortableJS 結束拖曳）。
  const release = (x: number, y: number): void => {
    if (upFired) return;
    upFired = true;
    const dropEl = document.elementFromPoint(x, y) ?? document;
    fireDrag(dropEl, 'up', x, y);
  };
  // 同步收尾（idempotent）。aborted=true：以「非提交式」結束——先把游標移到畫面外，
  // 讓 App 落點預覽清為 null，再放開，使 SortableJS 結束但 commitDrop 無合法落點、不改 store
  // （避免中途切步驟時，commitDrop 於下一步 resetDemoBoard 之後才落地而污染版面）。
  // 也保證「只要按下過就一定放開」，否則浮動分身會黏在使用者真實滑鼠上。
  const cleanup = (aborted: boolean): void => {
    if (cleaned) return;
    cleaned = true;
    if (downFired && !upFired) {
      if (aborted) {
        fireDrag(document, 'move', -99999, -99999);
        release(-99999, -99999);
      } else {
        release(target.x, target.y);
      }
    }
    REAL_EVENTS.forEach((t) => window.removeEventListener(t, swallowReal, true));
    document.body.classList.remove('tour-dragging');
    blockers.forEach((el, i) => (el.style.pointerEvents = savedPE[i]));
    abortDrag = null;
  };
  abortDrag = () => cleanup(true); // 供 cancelDemo 於切步驟時「同步」中止拖曳
  try {
    const sr = sourceEl.getBoundingClientRect();
    const start: Pt = { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
    fireDrag(sourceEl, 'down', start.x, start.y);
    downFired = true;
    await sleep(160, token);
    // rAF 逐幀平滑內插（~60fps）：move 派發在座標下真實元素上，使 App 的 event.target
    // 落在泳道內、能 .closest('[data-drop-zone]') 命中；事件仍冒泡到 window/document，
    // SortableJS forceFallback 與落點預覽都收得到。指標/漣漪/遮罩皆 pointer-events:none。
    await animateDrag(start, target, 900, token);
    await sleep(hold, token); // 於落點略停（刪除區可加長，讓紅色警告態看清楚）
    release(target.x, target.y);
    await sleep(200, token);
    cleanup(false);
  } catch (e) {
    cleanup(true); // 被取消（CancelledError）→ 非提交式收尾
    throw e;
  }
}

/**
 * 步驟 n2：模板庫（合併原 o2 通用模板庫 + o4 角色模板；全程無 spotlight）。
 *   前半（o2）：點「通用」分頁 → 拖最後一個通用區塊到 c1 泳道。
 *   —— 中場略停 ——
 *   後半（o4）：點「自訂」分頁 → 拖 c1 的「RZ」區塊回側邊欄自訂區存成角色模板。
 */
async function demoStep2(token: number): Promise<void> {
  await sleep(650, token); // 等 reset + 切分頁渲染

  // 1) 點「通用」分頁
  const genTab = document.getElementById('tab-general');
  const gp = genTab ? centerOf(genTab) : null;
  if (gp) {
    await cursorEnter(gp, 600, token);
    await sleep(300, token);
    clickFx(gp);
    genTab!.click();
  }
  await sleep(650, token);

  // 2) 移到最後一個通用區塊、略停，真實拖曳到 c1（slot 0）現有區塊中間、泳道垂直中心
  const chips = [...document.querySelectorAll<HTMLElement>('#tabpanel-general .chip-wrapper')];
  const last = chips[chips.length - 1];
  if (last) {
    await moveToEl(last, 850, token);
    await sleep(800, token);
    const laneBlocks = [...document.querySelectorAll<HTMLElement>('[data-slot-index="0"] .rotation-block')];
    const track = document.querySelector('[data-slot-index="0"] .swimlane__track') as HTMLElement | null;
    let target: Pt | null = null;
    if (laneBlocks.length >= 2) {
      const a = laneBlocks[0].getBoundingClientRect();
      const b = laneBlocks[laneBlocks.length - 1].getBoundingClientRect();
      target = { x: (a.left + b.right) / 2, y: (a.top + a.bottom) / 2 };
    } else if (track) {
      const r = track.getBoundingClientRect();
      target = { x: r.left + r.width * 0.35, y: r.top + r.height / 2 };
    }
    if (target) await realDrag(last, target, token);
  }

  // —— 中場略停，接續示範「存成角色模板」（原 o4）——
  await sleep(1000, token);

  // 3) 點「自訂」分頁
  const customTab = document.getElementById('tab-custom');
  const cp = customTab ? centerOf(customTab) : null;
  if (cp) {
    await moveToEl(customTab, 700, token);
    await sleep(300, token);
    clickFx(cp);
    customTab!.click();
  }
  await sleep(800, token);

  // 4) 移到 c1 的「RZ」區塊並停留（觸發 hover）
  const rz = [...document.querySelectorAll<HTMLElement>('[data-slot-index="0"] .rotation-block')]
    .find((b) => b.textContent?.trim() === 'RZ');
  if (!rz) return;
  const rp = await moveToEl(rz, 650, token);
  rz.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); // 顯示 hover 態
  if (rp) await sleep(600, token);

  // 5) 真實拖曳 RZ 到側邊欄自訂區並放開（落點在 data-sidebar-zone 內 → 存成模板）
  const panel = (document.getElementById('tabpanel-custom')
    ?? document.querySelector('.sidebar-panel')) as HTMLElement | null;
  const target = panel ? centerOf(panel) : null;
  if (target) await realDrag(rz, target, token);
  await sleep(1000, token);
}

/** 對真實元件派發合成 keydown（isTrusted=false 可穿過導覽鍵盤攔截）。
 *  務必派發於帶 tagName 的元件（非 window）：快捷鍵焦點守衛讀 target.tagName。 */
function pressKey(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
/** 提交行內編輯：對輸入框派發 Enter。 */
function pressEnter(el: HTMLElement): void {
  pressKey(el, 'Enter');
}
/** 派發帶 Ctrl（Mac 併帶 Meta）的合成 keydown，觸發剪貼簿／歷史快捷鍵。 */
function pressCtrl(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', {
    key, ctrlKey: true, metaKey: true, bubbles: true, cancelable: true,
  }));
}

/** 取得當前行內編輯輸入框並設為純觀看（使用者打不進字；程式設值 + input 事件仍有效）。 */
function grabEditInput(): HTMLInputElement | null {
  const input = document.querySelector('.rotation-block__input') as HTMLInputElement | null;
  if (input) input.readOnly = true;
  return input;
}

/**
 * 步驟 n3：新增與編輯區塊（合併原 o3/o5；子步驟多，停頓一律縮短）。
 *   1) 同 o3：點 c1 泳道「＋」→ 輸入「EA」→ Enter。
 *   2) 指標移到 c1 第一個區塊「E」並點選。
 *   3) 按 Space → 於選取區塊後插入空白區塊並進入編輯。
 *   4) 輸入「AA」→ Enter（示範打錯字）。
 *   5) 該區塊仍在選取中 → 按 Enter 重新編輯 → 改輸入「Q」→ Enter。
 */
async function demoStep3(token: number): Promise<void> {
  await sleep(600, token); // 等 reset 後版面渲染

  // 1) 移到 c1 泳道的「＋」新增鈕並點擊 → 輸入「EA」→ Enter
  const addBtn = document.querySelector('[data-tour="add-block"]') as HTMLElement | null;
  if (!addBtn) return;
  const ap = centerOf(addBtn);
  if (ap) {
    await cursorEnter(ap, 550, token);
    await sleep(200, token);
    clickFx(ap);
  }
  addBtn.click(); // 真實新增空白區塊 + 進入行內編輯（輸入框自動聚焦）
  await sleep(450, token); // 等 nextTick 渲染輸入框並聚焦
  let input = grabEditInput();
  if (!input) return;
  const ip = centerOf(input);
  if (ip) await moveTo(ip.x, ip.y + 20, 400, token);
  await typeInto(input, 'EA', token);
  await sleep(350, token);
  pressEnter(input);
  await sleep(650, token);

  // 2) 點選 c1 第一個區塊「E」
  const eBlock = [...document.querySelectorAll<HTMLElement>('[data-slot-index="0"] .rotation-block')]
    .find((b) => b.textContent?.trim() === 'E');
  if (!eBlock) return;
  const ep = await moveToEl(eBlock, 600, token);
  if (ep) clickFx(ep);
  clickBlock(eBlock, ep, false);
  await sleep(500, token);

  // 3) Space：合成鍵盤事件（isTrusted=false 可穿過導覽攔截）走真實快捷鍵流程，
  //    於選取區塊後插入空白區塊並進入行內編輯。派發於真實區塊而非 window：
  //    快捷鍵處理器的焦點守衛讀 event.target.tagName，target=window 無 tagName 會拋錯。
  pressKey(eBlock, ' ');
  await sleep(450, token);

  // 4) 輸入「AA」→ Enter（示範打錯字）
  input = grabEditInput();
  if (!input) return;
  const np = centerOf(input);
  if (np) await moveTo(np.x, np.y + 20, 350, token);
  await typeInto(input, 'AA', token);
  await sleep(300, token);
  pressEnter(input);
  await sleep(600, token);

  // 5) 該區塊提交後仍在選取中（選取與編輯狀態獨立）→ 按 Enter 重新編輯 → 改輸入「Q」→ Enter。
  //    Enter 派發於 document.body（有 tagName、非輸入元素），走 editSelectedLabels 重進編輯。
  pressKey(document.body, 'Enter');
  await sleep(400, token); // 等輸入框出現（進場已全選原文字）
  input = grabEditInput();
  if (!input) return;
  const qp = centerOf(input);
  if (qp) await moveTo(qp.x, qp.y + 20, 300, token);
  await typeInto(input, 'Q', token);
  await sleep(350, token);
  pressEnter(input);
  await sleep(1000, token);
}

/** 在指定區塊上派發一次點擊（可帶 Ctrl 作多選）。直接派發於元件，繞過遮罩。 */
function clickBlock(el: HTMLElement, p: Pt | null, ctrl: boolean): void {
  el.dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true, view: window,
    clientX: p?.x ?? 0, clientY: p?.y ?? 0, button: 0, ctrlKey: ctrl,
  }));
}

/** 框選兩個區塊：於 board 空白處起手 mousedown → 拉出矩形（window mousemove）→ mouseup。
 *  矩形限定在該泳道 y 帶、橫跨兩塊，故只命中這兩塊。事件直接派發、以座標判定，不受遮罩影響。 */
async function marqueeSelect(a: HTMLElement, b: HTMLElement, token: number): Promise<void> {
  const boardScroll = document.querySelector('.board__scroll') as HTMLElement | null;
  if (!boardScroll) return;
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const left = Math.min(ra.left, rb.left);
  const right = Math.max(ra.right, rb.right);
  const top = Math.min(ra.top, rb.top);
  const bottom = Math.max(ra.bottom, rb.bottom);
  const start: Pt = { x: left - 22, y: top - 10 };
  const end: Pt = { x: right + 22, y: bottom + 10 };

  await moveTo(start.x, start.y, 750, token);
  await sleep(200, token);
  // mousedown 的 target 需為 board 空白（closest .board__scroll、非區塊）→ 直接派發於 boardScroll。
  boardScroll.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, view: window, button: 0, clientX: start.x, clientY: start.y,
  }));
  // 拉出選取框：useMarquee 的 onMove 只讀座標，派發於 window 即可。
  await animateCursor(start, end, 900, token, (x, y) => {
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window, clientX: x, clientY: y }));
  });
  await sleep(150, token);
  window.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true, view: window, button: 0, clientX: end.x, clientY: end.y,
  }));
}

/**
 * 步驟 o6：多重選取。
 *   1) 焦點在排軸板（含三泳道與下方空白）。
 *   2) 對 c2 的「E」「2A」各 Ctrl+點擊 → 累加多選。
 *   3) 移到空白處點擊 → 清除選取。
 *   4) 拉出選取框再次框選這兩塊。
 *   5) 多選拖曳到最左（連招最前）。
 */
async function demoStep4(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染

  const c2 = [...document.querySelectorAll<HTMLElement>('[data-slot-index="1"] .rotation-block')];
  const eBlock = c2.find((b) => b.textContent?.trim() === 'E');
  const aBlock = c2.find((b) => b.textContent?.trim() === '2A');
  if (!eBlock || !aBlock) return;

  // 2) Ctrl+點擊 E → 再 Ctrl+點擊 2A（累加多選）
  let p = centerOf(eBlock);
  if (p) await cursorEnter(p, 800, token);
  if (p) clickFx(p);
  clickBlock(eBlock, p, true);
  await sleep(550, token);
  p = await moveToEl(aBlock, 500, token);
  if (p) clickFx(p);
  clickBlock(aBlock, p, true);
  await sleep(650, token);

  // 3) 就近點右側空白處 → 清除選取（冒泡到 app-root @click clearAllSelection）。
  //    不必移到最下方，2A 右側同列即為空白（c2 只有 E、2A 兩塊）。
  const boardScroll = document.querySelector('.board__scroll') as HTMLElement | null;
  if (boardScroll) {
    const ar = aBlock.getBoundingClientRect();
    const bs = boardScroll.getBoundingClientRect();
    const blank: Pt = { x: Math.min(ar.right + 10, bs.right - 60), y: ar.top + ar.height / 2 };
    await moveTo(blank.x, blank.y, 550, token);
    clickFx(blank);
    boardScroll.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: window, clientX: blank.x, clientY: blank.y, button: 0,
    }));
    await sleep(650, token);
  }

  // 4) 拉出選取框再次框選這兩塊
  await marqueeSelect(eBlock, aBlock, token);
  await sleep(750, token);

  // 5) 多選拖曳到泳道 header 右緣附近（track 起點），不必拖到最左邊。
  const track = document.querySelector('[data-slot-index="1"] .swimlane__track') as HTMLElement | null;
  const cr = track?.getBoundingClientRect();
  if (cr) {
    // 先把指標從框選終點平滑移到要拖的區塊，避免直接起拖時指標瞬移（看似瞬移）。
    await moveToEl(eBlock, 500, token);
    await sleep(250, token);
    const target: Pt = { x: cr.left + 24, y: cr.top + cr.height / 2 };
    await realDrag(eBlock, target, token); // eBlock 仍在選取集合 → 整組多選拖曳
  }
  await sleep(800, token);
}

/**
 * 步驟 o7：刪除區塊。
 *   1) 指標移到 c3 的「AAE」區塊。[焦點：三泳道與下方空白]
 *   2) 真實拖曳到下方刪除區（略停顯示紅色警告態）後放開 → 刪除該區塊。
 */
async function demoStep5(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染

  const aae = [...document.querySelectorAll<HTMLElement>('[data-slot-index="2"] .rotation-block')]
    .find((b) => b.textContent?.trim() === 'AAE');
  if (!aae) return;

  // 1) 移到 AAE 並停留
  const p = centerOf(aae);
  if (p) await cursorEnter(p, 850, token);
  aae.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  if (p) await sleep(700, token);

  // 2) 拖到最後一個泳道「下方」的空白（刪除區：.rotation-board 有 data-delete-zone，
  //    非泳道 track 處即刪除區）。用 c3 泳道實際底部推算，避開 board 底緣的水平捲軸。
  const lastLane = document.querySelector('[data-slot-index="2"]') as HTMLElement | null;
  const board = document.querySelector('.rotation-board') as HTMLElement | null;
  const aRect = aae.getBoundingClientRect();
  if (lastLane && board) {
    const lr = lastLane.getBoundingClientRect();
    const br = board.getBoundingClientRect();
    // 略低於 c3 泳道底部即進入下方空白刪除區；clamp 在 board 內並離底緣 22px（避開捲軸/邊框）。
    const y = Math.min(lr.bottom + 26, br.bottom - 22);
    const target: Pt = { x: aRect.left + aRect.width / 2, y };
    await realDrag(aae, target, token, 800); // hold 加長，讓紅色「可刪除」警告態看清楚
  }
  await sleep(1200, token);
}

/**
 * 步驟 n4（原 o8）：區塊與泳道巡覽。
 *   1) 同 o8：穩定節奏按 8 次 <D>，逐塊循環整條輸出軸的選取焦點。
 *   2) 快速按 4 次 <S>，依顯示順序逐條往下循環選取整條泳道。
 *   3) 泳道選取中按 <Space> → 於全軸末尾新增該泳道區塊並進編輯 → 輸入「EA」→ <Enter>。
 *   註：導覽期間 A/D／W/S 已被攔截去切步驟，故直接呼叫 App 的巡覽 action；
 *       Space/Enter 以合成鍵盤事件（isTrusted=false）穿過攔截走真實流程。
 */
async function demoStep6(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染
  hideCursor(); // 本步為鍵盤操作，不需虛擬指標

  const nav = useBlockNavigation();
  const rotationStore = useRotationStore();
  rotationStore.clearSelection();
  await sleep(400, token);

  // 1) 穩定節奏按 8 次 D：無選取時 D 先選最左塊，其後逐塊往右循環。
  for (let i = 0; i < 8; i++) {
    checkToken(token);
    nav.focusStep(1);
    await sleep(500, token);
  }
  await sleep(600, token);

  // 2) 按 4 次 S：依顯示順序逐條往下循環選取整條泳道。
  for (let i = 0; i < 4; i++) {
    checkToken(token);
    nav.focusLaneStep(1);
    await sleep(500, token);
  }
  await sleep(600, token);

  // 3) Space（泳道選取中）→ 於全軸末尾新增該泳道區塊並進編輯 → 輸入「EA」→ Enter。
  //    派發於 document.body（有 tagName、非輸入元素）以穿過快捷鍵焦點守衛。
  pressKey(document.body, ' ');
  await sleep(450, token); // 等 nextTick 渲染輸入框並聚焦
  const input = grabEditInput();
  if (!input) return;
  await typeInto(input, 'EA', token);
  await sleep(350, token);
  pressEnter(input);
  await sleep(1000, token);
}

/**
 * 步驟 n5：剪貼簿與歷史（焦點在 c1〔長離〕泳道）。
 *   1) 對 c1 的「E」「RZ」各 Ctrl+點擊 → 累加多選。
 *   2) 按 Ctrl+X 剪下。
 *   3) 指標移到全軸末尾的「A」區塊並點選。
 *   4) 按 Ctrl+V 貼上（略停）。
 *   5) 連按兩次 Ctrl+Z 復原。
 *   註：Ctrl 組合以合成鍵盤事件（isTrusted=false）穿過導覽攔截走真實流程；
 *       派發於 document.body（有 tagName、非輸入元素）以過焦點守衛。
 */
async function demoStep7(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染

  const find = (label: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('[data-slot-index="0"] .rotation-block')]
      .find((b) => b.textContent?.trim() === label);

  // 1) Ctrl+點擊 E → 再 Ctrl+點擊 RZ（累加多選）
  const eBlock = find('E');
  const rzBlock = find('RZ');
  if (!eBlock || !rzBlock) return;
  let p = centerOf(eBlock);
  if (p) await cursorEnter(p, 800, token);
  if (p) clickFx(p);
  clickBlock(eBlock, p, true);
  await sleep(500, token);
  p = await moveToEl(rzBlock, 500, token);
  if (p) clickFx(p);
  clickBlock(rzBlock, p, true);
  await sleep(650, token);

  // 2) Ctrl+X 剪下
  pressCtrl(document.body, 'x');
  await sleep(800, token);

  // 3) 指標移到全軸末尾的「A」區塊並點選（單選取代原選取）
  const aBlock = find('A');
  if (!aBlock) return;
  p = await moveToEl(aBlock, 700, token);
  if (p) clickFx(p);
  clickBlock(aBlock, p, false);
  await sleep(550, token);

  // 4) Ctrl+V 貼上（於選取區塊後插入剪下的區塊），略停
  pressCtrl(document.body, 'v');
  await sleep(1100, token);

  // 5) 連按兩次 Ctrl+Z 復原
  for (let i = 0; i < 2; i++) {
    checkToken(token);
    pressCtrl(document.body, 'z');
    await sleep(700, token);
  }
  await sleep(1000, token);
}

/**
 * 步驟 n6：調整角色順序（泳道垂直拖曳重排）。
 *   1) 指標移到 c1（長離）泳道 header 的拖曳把手並略停。
 *   2) 垂直拖曳整條泳道到第三位（最下方）後放開 → laneOrder 更新、平滑滑入。
 *   註：泳道重排靠把手 mousedown + window mousemove/mouseup 座標驅動（不經 SortableJS、
 *       不用 elementFromPoint），故直接派發合成滑鼠事件即可，無需關遮罩。
 */
async function demoStep8(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染

  const handle = document.querySelector('[data-slot-index="0"] .header__drag-handle') as HTMLElement | null;
  const lane2 = document.querySelector('.swimlane[data-slot-index="2"]') as HTMLElement | null;
  if (!handle || !lane2) return;

  // 1) 移到拖曳把手並略停
  const hp = centerOf(handle);
  if (!hp) return;
  await cursorEnter(hp, 850, token);
  await sleep(600, token);
  clickFx(hp);

  // 「只要按下過就一定放開」：中途切步驟/Esc 時，useLaneReorder 仍掛著 window
  // mouseup 監聽等待放開；若不補送 mouseup，浮動分身會黏在使用者真實滑鼠上、
  // laneDrag 狀態也不還原。以 release 保證放開（idempotent），並註冊給 cancelDemo。
  let downFired = false;
  let upFired = false;
  const release = (x: number, y: number): void => {
    if (!downFired || upFired) return;
    upFired = true;
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, view: window, button: 0, clientX: x, clientY: y,
    }));
    abortDrag = null;
  };
  // 供 cancelDemo 於切步驟/Esc 時「同步」結束泳道拖曳（放開後 laneOrder 交由
  // resetDemoBoard/restore 還原，故落點無妨，只需確保拖曳確實結束）。
  abortDrag = () => release(-99999, -99999);
  try {
    // 2) mousedown 於把手起拖 → window mousemove 逐幀往下越過最後泳道中點 → mouseup 落到第三位
    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, view: window, button: 0, clientX: hp.x, clientY: hp.y,
    }));
    downFired = true;
    const lr = lane2.getBoundingClientRect();
    const target: Pt = { x: hp.x, y: lr.top + lr.height * 0.75 };
    await animateCursor(hp, target, 950, token, (x, y) => {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window, clientX: x, clientY: y }));
    });
    await sleep(300, token);
    release(target.x, target.y);
    await sleep(1200, token);
  } catch (e) {
    release(-99999, -99999); // 被取消（CancelledError）→ 同步放開，收拾拖曳
    throw e;
  }
}

/**
 * 熱鍵模式導覽 step 1：模式內輸入示範（聚焦泳道區）。
 *   1) 若不在熱鍵輸入模式 → 主動進入（側欄收合定型後重畫遮罩）。
 *   2) 連續按兩次 E（速度中上）。
 *   3) 按 3 切到泳道 3 → 按 Q、R → 長按滑鼠左鍵插入「Z」。
 *   4) 長按 2 → 切到泳道 2 並插入入場技「Intro」。
 *   註：鍵盤走合成 keydown/keyup（isTrusted=false 穿過導覽攔截，經
 *       useKeyboardShortcuts 分派給模式）；滑鼠直接對 .hotkey-overlay 派發。
 */
async function demoHotkey1(token: number): Promise<void> {
  const mode = useHotkeyInputMode();
  hideCursor();

  // 1) 確保處於熱鍵模式且版面已定型後，才套 spotlight 並開始輸入：
  //    - 首次進入：begin() 已進入模式並等收合定型，這裡模式為 active → 不重進，
  //      僅重算代理框、重畫遮罩。
  //    - 從 step 2 切回：模式已被 demoHotkey2 退出 → 這裡主動進入並等收合定型，
  //      以乾淨狀態重建（泳道選取回第一條、按壓計時清空、幽靈格置中）。
  if (!mode.active.value) {
    mode.enter();
    await sleep(500, token); // 等側欄收合過渡（0.25s）定型
  } else {
    await sleep(200, token); // 等 reset 後版面渲染
  }
  // 補選泳道：每步進場的 resetDemoBoard→clearSelection 會把 selectedLaneIndex 清為 null，
  // 而「首次進入」路徑下 begin() 已 enter 過、demoHotkey1 不再 enter，泳道選取不會被
  // ensureLaneSelected 補回 → insertEntry 因 lane=null 提早 return（按鍵有送出、鍵帽出現，
  // 但沒加區塊）。這裡明確選回第一條可選泳道，涵蓋所有進入路徑（首次/重播/步驟回退）。
  const rotationStore = useRotationStore();
  if (rotationStore.selectedLaneIndex === null) {
    const lanes = mode.selectableLanes.value;
    if (lanes.length > 0) rotationStore.selectLane(lanes[0]);
  }
  syncHotkeyLaneProxy();
  tourApi?.refresh();
  await sleep(650, token); // 聚光燈穩定顯示後再開始送出按鍵

  // 2) 連續按兩次 E
  await tapModeKey('KeyE', 'e', 'E', token);
  await sleep(650, token);
  await tapModeKey('KeyE', 'e', 'E', token);
  await sleep(950, token);

  // 3) 切到泳道 3 → Q、R → 長按左鍵（≥300ms 判 hold → 插入「Z」）
  await tapModeKey('Digit3', '3', '3', token);
  await sleep(800, token);
  await tapModeKey('KeyQ', 'q', 'Q', token);
  await sleep(650, token);
  await tapModeKey('KeyR', 'r', 'R', token);
  await sleep(800, token);

  const overlay = document.querySelector('.hotkey-overlay') as HTMLElement | null;
  const ghost = centerOf('.track__ghost-cell');
  if (overlay) {
    // 指標移到幽靈格（下一個落點）上按住左鍵，看得到長按進度環
    if (ghost) await cursorEnter(ghost, 650, token);
    keycapDown(t('hotkey.mouseLeft'));
    ensureCursor().classList.add('tour-cursor--press');
    overlay.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, view: window, button: 0,
      clientX: ghost?.x ?? 0, clientY: ghost?.y ?? 0,
    }));
    try {
      await sleep(620, token);
    } finally {
      // 取消時也放開：模式的按壓計時（_pressStartAt）不殘留
      overlay.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: window, button: 0,
        clientX: ghost?.x ?? 0, clientY: ghost?.y ?? 0,
      }));
      ensureCursor().classList.remove('tour-cursor--press');
      keycapUp();
    }
    if (ghost) clickFx(ghost);
  }
  await sleep(1000, token);
  hideCursor();

  // 4) 長按 2：keydown 即切到泳道 2，按滿閾值放開 → 插入入場技「Intro」
  await holdModeKey('Digit2', '2', '2', 620, token);
  await sleep(1100, token);
}

/**
 * 熱鍵模式導覽 step 2：熱鍵對映表入口（全程無 spotlight）。
 *   1) 退出熱鍵輸入模式。
 *   2) 指標自畫面中央出現 → 移到標題列齒輪鈕懸停 → 點開設定面板（速度中上）。
 *   3) 面板往下捲到「熱鍵對映表」列（速度中等）。
 *   4) 點「編輯對映表」開啟編輯視窗；hint box（driver 氣泡）移到畫面左側避免遮擋。
 */
async function demoHotkey2(token: number): Promise<void> {
  const mode = useHotkeyInputMode();
  await sleep(400, token);

  // 1) 退出模式（側欄還原過渡 0.25s）
  if (mode.active.value) mode.exit();
  await sleep(500, token);

  // 2) 指標從畫面中央滑到齒輪鈕（hover 為 CSS :hover 無法合成觸發，以停頓示意）
  const gear = document.querySelector('.settings-menu__trigger') as HTMLElement | null;
  if (!gear) return;
  cursorInstant(window.innerWidth / 2, window.innerHeight / 2);
  showCursor();
  const gp = await moveToEl(gear, 750, token);
  if (!gp) return;
  await sleep(500, token);
  clickFx(gp);
  gear.click(); // 真實開啟設定面板（Teleport 到 body）
  await sleep(650, token);

  // 3) 面板平滑捲到「熱鍵對映表」列（唯一的 link-btn 即「編輯對映表」；速度中等）
  const panel = document.querySelector('.settings-menu__panel') as HTMLElement | null;
  const editBtn = panel?.querySelector('.settings-menu__link-btn') as HTMLElement | null;
  if (!panel || !editBtn) return;
  await smoothScrollTo(panel, editBtn, 1100, token);
  await sleep(400, token);

  // 4) 點「編輯對映表」；開窗前先把 driver 氣泡釘到畫面左側，避免蓋住編輯視窗
  const bp = await moveToEl(editBtn, 650, token);
  if (bp) {
    await sleep(350, token);
    clickFx(bp);
  }
  document.querySelector('.driver-popover')?.classList.add('tour-popover--left');
  // 標記編輯視窗導覽中：讓對映表視窗向右讓位，避免被左側氣泡遮到左半（見 App.vue）。
  document.body.classList.add('tour-hk-editing');
  editBtn.click(); // 真實開啟對映表編輯視窗（設定面板隨之自動收合）
  await sleep(900, token);
  hideCursor();
}

const DEMOS: Record<number | string, (token: number) => Promise<void>> = {
  1: demoStep1,
  2: demoStep2,
  3: demoStep3,
  4: demoStep4,
  5: demoStep5,
  6: demoStep6,
  7: demoStep7,
  8: demoStep8,
  hk1: demoHotkey1,
  hk2: demoHotkey2,
};

/** 播放指定步驟的示範動畫（若該步無腳本則無動作）。 */
export function runDemo(step: number | string): void {
  cancelDemo();
  const demo = DEMOS[step];
  if (!demo) return;
  const token = ++runToken;
  // 不在此 showCursor：舊指標剛被 cancelDemo 淡出，各步驟以 cursorEnter 於定位後現身。
  Promise.resolve()
    .then(() => demo(token))
    .catch((e) => {
      if (!(e instanceof CancelledError)) console.warn('[useTourDemo] 示範動畫錯誤', e);
    })
    .finally(() => {
      if (token === runToken) hideCursor();
    });
}

/** 取消目前示範動畫並同步收拾所有暫態：指標、進行中拖曳（非提交式）、角色下拉、確認框。 */
export function cancelDemo(): void {
  runToken++;
  hideCursor();
  // 鍵帽立即隱藏（不走 keycapUp 的停留淡出，避免殘留到下一步）。
  if (keycapFadeTimer !== null) {
    clearTimeout(keycapFadeTimer);
    keycapFadeTimer = null;
  }
  if (keycapEl) {
    keycapEl.classList.remove('tour-keycap--press');
    keycapEl.style.opacity = '0';
  }
  // 熱鍵導覽 step 2 的殘留：氣泡靠左釘選、視窗讓位標記、設定面板、對映表編輯視窗
  //（主導覽不會開，無副作用）。
  document.querySelector('.driver-popover')?.classList.remove('tour-popover--left');
  document.body.classList.remove('tour-hk-editing');
  if (document.querySelector('.settings-menu__panel')) document.body.click(); // 外點關閉設定面板
  useHotkeyMapDialog().close();
  // 同步收掉進行中的真實拖曳（非提交式，不改動 store），避免中途切步驟後
  // commitDrop 於下一步 resetDemoBoard 之後才落地而污染版面。
  abortDrag?.();
  // 角色下拉靠 document 的 mousedown（點在 root/listbox 外）關閉；
  // 只在確實有開著（listbox 已 Teleport 到 body）時派發，避免多餘副作用。
  if (document.querySelector('.char-selector__listbox')) {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }
  // 關掉示範中可能開著的確認框（如 step1 換角確認），避免殘留在畫面上。
  (document.querySelector('.dialog-overlay .dialog__btn--cancel') as HTMLElement | null)?.click();
}

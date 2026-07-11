// ============================================================
// useTourDemo.ts — 導覽示範動畫引擎（虛擬指標 + App 原生真實效果）。
//
// 原則：
//   - 效果一律走 App「真實互動」：以程式對真實元件派發 click/scroll 等，
//     觸發原生下拉、確認框、換角等；不做假的視覺模擬。
//   - 指標（tour-cursor）僅為視覺提示，指向正在操作的元件；漣漪標示點擊。
//   - 版面重設、歷史/狀態還原由 useSpotlightTour 負責；本檔只演操作。
//   - 以遞增 runToken 實作取消：primitives 每次檢查 token，過期即拋出中止。
//   - 步驟腳本逐步建置（目前：Step 1）。
// ============================================================

import { CHARACTER_MAP } from '@/constants/characters';
import { characterDisplayName } from '@/i18n';
import { useBlockNavigation } from '@/composables/board/useBlockNavigation';
import { useRotationStore } from '@/stores/useRotationStore';

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

// spotlight 操作（refocus/refresh）的 token 守衛：快速切步驟時 runDemo 會 cancelDemo
// （runToken++）殺掉舊 demo，但舊 demo 若剛好在此刻要移動/重畫遮罩，會把 spotlight
// 拉回上一步元件而殘留。故過期 token 一律略過，不再動遮罩。
function tourRefocus(token: number, selector: string): void {
  if (token === runToken) tourApi?.refocus(selector);
}
function tourRefresh(token: number): void {
  if (token === runToken) tourApi?.refresh();
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

let cursorPos: Pt = { x: -100, y: -100 };

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
  cursorPos = { x, y };
  void el.offsetWidth; // 強制 reflow，讓後續 transition 生效
}

/** 平滑移動指標到 (x,y)，耗時 dur。 */
async function moveTo(x: number, y: number, dur: number, token: number): Promise<void> {
  checkToken(token);
  const el = ensureCursor();
  el.style.transition = `transform ${dur}ms cubic-bezier(0.45, 0, 0.2, 1), opacity 0.2s ease`;
  el.style.transform = `translate(${x}px, ${y}px)`;
  cursorPos = { x, y };
  await sleep(dur, token);
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

/** 逐字輸入到行內編輯框：每字設 value 並派發 input 事件（驅動 Vue v-model 與寬度重算）。
 *  onChange 於每字輸入後呼叫（供同步重畫 spotlight 遮罩，區塊變寬時遮罩才跟上）。 */
async function typeInto(
  input: HTMLInputElement,
  text: string,
  token: number,
  onChange?: () => void,
): Promise<void> {
  input.focus();
  for (let i = 1; i <= text.length; i++) {
    checkToken(token);
    input.value = text.slice(0, i);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(60, token); // 等 Vue 依草稿重算欄寬渲染，再重畫遮罩
    onChange?.();
    await sleep(110, token);
  }
}

// ──────────────────────────────────────────────────────────
// 步驟腳本
// ──────────────────────────────────────────────────────────

/**
 * 步驟 1：選角。
 *   1) 指標移到 c1 頭像、略停 hover，直接點擊開下拉。
 *   2) 捲動找到「莫寧(Mornye)」→ 點選 → 確認換角（清空區塊）。
 */
async function demoStep1(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染
  const header = document.querySelector('[data-tour="lane-header"]') as HTMLElement | null;
  if (!header) return;
  showCursor();

  // 1) 指標移到頭像、略停 hover，直接點擊開下拉
  const frame = header.querySelector('.header__portrait-frame');
  const ap = frame ? centerOf(frame) : null;
  if (ap) {
    cursorInstant(ap.x - 38, ap.y + 30);
    await moveTo(ap.x, ap.y, 800, token);
    await sleep(650, token); // 略停 hover
    clickFx(ap);
  }
  (header.querySelector('.char-selector__trigger') as HTMLElement | null)?.click();
  await sleep(900, token);

  // 找「莫寧」選項（與 c1 同屬性，開啟即在同一 tab，捲動即可）
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
      cursorPos = { x, y };
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
 * 步驟 2：通用模板庫。（spotlight 全程聚焦排軸板）
 *   1) 指標移到「通用」分頁並點擊（示範點擊）。
 *   2) 指標移到最後一個通用區塊（略停），真實拖曳到 c1 泳道中間。
 */
async function demoStep2(token: number): Promise<void> {
  await sleep(650, token); // 等 reset + 切分頁渲染
  showCursor();

  // 1) 點「通用」分頁
  const genTab = document.getElementById('tab-general');
  const gp = genTab ? centerOf(genTab) : null;
  if (gp) {
    cursorInstant(gp.x - 46, gp.y + 34);
    await moveTo(gp.x, gp.y, 600, token);
    await sleep(300, token);
    clickFx(gp);
    genTab!.click();
  }
  await sleep(650, token);

  // 2) 移到最後一個通用區塊、略停（spotlight 全程在排軸板，無需中途換焦點）
  const chips = [...document.querySelectorAll<HTMLElement>('#tabpanel-general .chip-wrapper')];
  const last = chips[chips.length - 1];
  if (!last) return;
  await moveToEl(last, 850, token);
  await sleep(800, token);

  // 真實拖曳到 c1（slot 0）現有區塊的水平中間、泳道垂直中心
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
  await sleep(1200, token);
}

/**
 * 步驟 3：新增自訂區塊。
 *   1) 指標移到 c1 泳道的「＋」新增鈕並點擊 → 真實新增空白區塊並進入行內編輯。
 *   2) 在輸入框逐字輸入「EA」，按 Enter 提交命名。
 */
async function demoStep3(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染
  showCursor();

  // 1) 移到 c1 泳道的「＋」新增鈕並點擊
  const addBtn = document.querySelector('[data-tour="add-block"]') as HTMLElement | null;
  if (!addBtn) return;
  const ap = centerOf(addBtn);
  if (ap) {
    cursorInstant(ap.x - 40, ap.y + 40);
    await moveTo(ap.x, ap.y, 650, token);
    await sleep(300, token);
    clickFx(ap);
  }
  addBtn.click(); // 真實新增空白區塊 + 進入行內編輯（輸入框自動聚焦）
  await sleep(550, token); // 等 nextTick 渲染輸入框並聚焦

  // 2) 逐字輸入「EA」→ 按 Enter 提交
  const input = document.querySelector('.rotation-block__input') as HTMLInputElement | null;
  if (!input) return;
  input.readOnly = true; // 純觀看：使用者打不進字；程式設值 + 派發 input 事件仍有效
  const ip = centerOf(input);
  if (ip) await moveTo(ip.x, ip.y + 20, 500, token);
  await sleep(300, token);
  await typeInto(input, 'EA', token);
  await sleep(550, token);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(1200, token);
}

/**
 * 步驟 4：角色模板（拖回側邊欄存成自訂模板）。
 *   1) 指標移到「自訂」分頁並點擊。[焦點：側邊欄]
 *   2) 焦點擴大到側邊欄＋排軸板；指標移到 c1 的「RZ」區塊並停留（觸發 hover）。
 *   3) 真實拖曳該區塊到側邊欄自訂區並放開 → 觸發「存成角色模板」。
 */
async function demoStep4(token: number): Promise<void> {
  await sleep(650, token); // 等 reset + 切分頁渲染
  showCursor();

  // 1) 點「自訂」分頁
  const customTab = document.getElementById('tab-custom');
  const cp = customTab ? centerOf(customTab) : null;
  if (cp) {
    cursorInstant(cp.x - 46, cp.y + 34);
    await moveTo(cp.x, cp.y, 800, token);
    await sleep(300, token);
    clickFx(cp);
    customTab!.click();
  }
  await sleep(800, token);

  // 2) 焦點擴大到側邊欄＋排軸板，再移到 c1 的「RZ」區塊並停留
  tourRefocus(token, '.app-layout');
  await sleep(550, token);
  const rz = [...document.querySelectorAll<HTMLElement>('[data-slot-index="0"] .rotation-block')]
    .find((b) => b.textContent?.trim() === 'RZ');
  if (!rz) return;
  const rp = await moveToEl(rz, 650, token);
  rz.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); // 顯示 hover 態
  if (rp) await sleep(600, token);

  // 3) 真實拖曳 RZ 到側邊欄自訂區並放開（落點在 data-sidebar-zone 內 → 存成模板）
  const panel = (document.getElementById('tabpanel-custom')
    ?? document.querySelector('.sidebar-panel')) as HTMLElement | null;
  const target = panel ? centerOf(panel) : null;
  if (target) await realDrag(rz, target, token);
  await sleep(1000, token);
}

/**
 * 步驟 5：編輯區塊內容。
 *   1) 指標移到 c1 最後一個區塊並停留，spotlight 聚焦到該區塊。
 *   2) 雙擊進入行內編輯，略停後把文字改成「AQ」並按 Enter 提交。
 */
async function demoStep5(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染
  showCursor();

  const blocks = [...document.querySelectorAll<HTMLElement>('[data-slot-index="0"] .rotation-block')];
  const last = blocks[blocks.length - 1];
  if (!last) return;
  const id = last.getAttribute('data-entry-id');

  // 1) 移到最後一個區塊 → 聚焦高亮該塊
  const p = await moveToEl(last, 950, token);
  last.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  if (id) tourRefocus(token, `[data-entry-id="${id}"]`);
  await sleep(1000, token);

  // 2) 雙擊進入編輯（RotationBlock @dblclick → startEditing，輸入框自動聚焦全選）
  if (p) clickFx(p);
  last.dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true, cancelable: true, clientX: p?.x, clientY: p?.y, view: window,
  }));
  await sleep(800, token); // 停一會兒等輸入框出現

  // 移動鼠標到label下方避免遮擋
  const lp = last ? centerOf(last) : null;
  if (lp) {
    await moveTo(lp.x, lp.y + 20, 500, token);
    await sleep(300, token);
  }

  const input = document.querySelector('.rotation-block__input') as HTMLInputElement | null;
  if (!input) return;
  input.readOnly = true; // 純觀看：使用者打不進字；程式設值 + 派發 input 事件仍有效
  await sleep(350, token);
  // 進場已全選原文字；typeInto 直接改寫 value → 逐字替換為「EQ」。
  // 每字後重畫遮罩，使 spotlight 隨區塊變寬同步擴張。
  await typeInto(input, 'EQ', token, () => tourRefresh(token));
  await sleep(550, token);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  // 提交後輸入框換回 chip，尺寸再變 → 等渲染完成後再重畫一次遮罩。
  await sleep(120, token);
  tourRefresh(token);
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
 * 步驟 6：多重選取。
 *   1) 焦點在排軸板（含三泳道與下方空白）。
 *   2) 對 c2 的「E」「2A」各 Ctrl+點擊 → 累加多選。
 *   3) 移到空白處點擊 → 清除選取。
 *   4) 拉出選取框再次框選這兩塊。
 *   5) 多選拖曳到最左（連招最前）。
 */
async function demoStep6(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染
  showCursor();

  const c2 = [...document.querySelectorAll<HTMLElement>('[data-slot-index="1"] .rotation-block')];
  const eBlock = c2.find((b) => b.textContent?.trim() === 'E');
  const aBlock = c2.find((b) => b.textContent?.trim() === '2A');
  if (!eBlock || !aBlock) return;

  // 2) Ctrl+點擊 E → 再 Ctrl+點擊 2A（累加多選）
  let p = await moveToEl(eBlock, 800, token);
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
    const blank: Pt = { x: Math.min(ar.right + 64, bs.right - 20), y: ar.top + ar.height / 2 };
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
 * 步驟 7：刪除區塊。
 *   1) 指標移到 c3 的「AAE」區塊。[焦點：三泳道與下方空白]
 *   2) 真實拖曳到下方刪除區（略停顯示紅色警告態）後放開 → 刪除該區塊。
 */
async function demoStep7(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染
  showCursor();

  const aae = [...document.querySelectorAll<HTMLElement>('[data-slot-index="2"] .rotation-block')]
    .find((b) => b.textContent?.trim() === 'AAE');
  if (!aae) return;

  // 1) 移到 AAE 並停留
  const p = await moveToEl(aae, 850, token);
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
 * 步驟 8：區塊巡覽（A/D 選上一個／下一個區塊）。
 *   模擬穩定節奏按 8 次 <D>，逐塊循環整條輸出軸的選取焦點。
 *   註：導覽期間 A/D 已被攔截去切步驟，故直接呼叫 App 的區塊巡覽 action，
 *       而非派發真實鍵盤事件。
 */
async function demoStep8(token: number): Promise<void> {
  await sleep(800, token); // 等 reset 後版面渲染
  hideCursor(); // 本步為鍵盤操作，不需虛擬指標

  const nav = useBlockNavigation();
  const rotationStore = useRotationStore();
  rotationStore.clearSelection();
  await sleep(400, token);

  // 穩定節奏按 8 次 D：無選取時 D 先選最左塊，其後逐塊往右循環。
  for (let i = 0; i < 8; i++) {
    checkToken(token);
    nav.focusStep(1);
    await sleep(620, token);
  }
  await sleep(1000, token);
}

const DEMOS: Record<number, (token: number) => Promise<void>> = {
  1: demoStep1,
  2: demoStep2,
  3: demoStep3,
  4: demoStep4,
  5: demoStep5,
  6: demoStep6,
  7: demoStep7,
  8: demoStep8,
};

/** 播放指定步驟的示範動畫（若該步無腳本則無動作）。 */
export function runDemo(step: number): void {
  cancelDemo();
  const demo = DEMOS[step];
  if (!demo) return;
  const token = ++runToken;
  showCursor();
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

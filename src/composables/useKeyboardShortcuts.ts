// ============================================================
// useKeyboardShortcuts.ts — 全域鍵盤快捷鍵管理。
//
// 設計原則：onMounted/onUnmounted 自動掛/卸監聽器；只在根層級（App.vue）呼叫
//           一次，避免多元件重複觸發。
//
// 結構：宣告式快捷鍵表（shortcuts）＋各動作 handler。keydown 分派器依序比對、
//       命中即執行並停止；新增快捷鍵＝新增一筆表項，不再修改分派邏輯。
//
// 快捷鍵一覽：
//   A / D（或 ← / →）  → 區塊巡覽：逐塊向左／右循環選取（無選取時選最右／最左塊）
//   W / S（或 ↑ / ↓）  → 泳道巡覽：上下循環選取整條泳道（並清除區塊選取）
//                         泳道選取中：Space＝於全軸末尾新增區塊並自動捲入視野；
//                         其他快捷鍵視同「該泳道所有區塊被選取」（先物化成
//                         區塊選取再走原流程）；Esc／點軌道空白處取消
//   Delete / Backspace  → 刪除選取的區塊
//   Ctrl+C              → 複製選取的區塊
//   Ctrl+X              → 剪下選取的區塊
//   Ctrl+V              → 貼上剪貼簿內容
//   Ctrl+D              → 向右複製選取的區塊
//   Ctrl+A              → 全選當前輸出軸的所有區塊
//   Ctrl+Z              → 復原（Undo）
//   Ctrl+Shift+Z / Ctrl+Y → 重做（Redo）
//   Ctrl+S              → 儲存變更至當前隊伍（自由模式＝開啟另存命名）
//   Ctrl+Shift+S        → 另存新檔（開啟隊伍管理並進入命名）
//   Space               → 在選取區塊之後插入空白區塊並進入編輯（無選取則不動作）
//   Enter               → 編輯選取區塊的文字；多選＝同步編輯全部（無選取則不動作）
//   Escape              → 清除所有選取
//   Tab                 → 展開／收合側邊欄
//   F                   → 進入熱鍵輸入模式（模式中所有既有快捷鍵停用，
//                         按鍵改由 useHotkeyInputMode.handleModeKeydown 分派）
// ============================================================

import { nextTick, onMounted, onUnmounted } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { useClipboard } from '@/composables/useClipboard';
import { useBlockNavigation } from '@/composables/board/useBlockNavigation';
import { useBoardScroll } from '@/composables/board/useBoardScroll';
import { useSidebarCollapse } from '@/composables/state/useSidebarCollapse';
import { useHistory } from '@/composables/state/useHistory';
import { useSavedTeamStore } from '@/stores/useSavedTeamStore';
import { useTeamManager } from '@/composables/state/useTeamManager';
import { useToast } from '@/composables/state/useToast';
import { useHotkeyInputMode } from '@/composables/state/useHotkeyInputMode';
import { getElementColor } from '@/constants/elements';
import { t } from '@/i18n';

// A/D 長按自動重複的最短間隔（ms）。放慢重複速度，使每步選中光暈（0.15s 過渡）
// 來得及浮現、焦點移動肉眼可跟；比原生 ~30ms 慢一截但仍具連續巡覽的流暢感。
const NAV_REPEAT_MS = 110;

/** 分派器每次 keydown 算好一次、傳給表項共用的比對上下文。 */
interface ShortcutContext {
  event: KeyboardEvent;
  key: string;
  /** Mac 對應 Meta（Command），Windows/Linux 對應 Ctrl。 */
  isCtrl: boolean;
}

/** 快捷鍵表項：matches 命中即執行 run 並停止比對。 */
interface ShortcutDef {
  matches: (ctx: ShortcutContext) => boolean;
  run: (ctx: ShortcutContext) => void;
}

export function useKeyboardShortcuts() {
  // 上一次「重複」巡覽事件的時間戳（模組外層宣告會跨實例共用，故置於函式內）。
  let _lastNavRepeatAt = 0;
  const rotationStore = useRotationStore();
  const characterStore = useCharacterStore();
  const clipboard = useClipboard();
  const nav = useBlockNavigation();
  const sidebarCollapse = useSidebarCollapse();
  const { scrollEntryIntoView } = useBoardScroll();
  const history = useHistory();
  const savedTeamStore = useSavedTeamStore();
  const teamManager = useTeamManager();
  const { showToast } = useToast();
  const hotkeyMode = useHotkeyInputMode();

  // ──────────────────────────────────────────
  // 動作 handler
  // ──────────────────────────────────────────

  /**
   * Ctrl+S：儲存變更至當前隊伍。已綁定存檔＝直接覆蓋回存檔（無變更則提示）；
   * 自由模式（未綁定）＝開啟隊伍管理並直接進入另存命名。
   */
  function saveTeamShortcut(): void {
    const team = savedTeamStore.currentTeam;
    if (!team) {
      teamManager.openSaveAs();
      return;
    }
    if (!savedTeamStore.isDirty) {
      showToast(t('teams.saved'), 'info');
      return;
    }
    savedTeamStore.saveToCurrent();
    showToast(t('teams.savedToast', { name: team.name }), 'success');
  }

  /**
   * Enter：編輯選取區塊的文字。輸入框掛在「第一個選取區塊」（時間序）上，
   * 多選時其餘成員即時鏡射草稿、提交時同一文字套用全部（批次機制見
   * rotationStore.editingBatchIds 與 Swimlane.handleCommitLabel）。
   * 既有區塊的再編輯不開交易（與雙擊編輯同模式），由 updateLabel 自行記一步。
   */
  function editSelectedLabels(): void {
    const selected = rotationStore.selectedEntries; // 已依 1D 陣列時間序排列
    if (selected.length === 0) return;
    const primary = selected[0];
    rotationStore.startEditing(primary.id, selected.map((e) => e.id));
    // 輸入框可能在可視範圍外 → 不在畫面內才跟隨鏡頭。
    scrollEntryIntoView(primary.id, { onlyIfNeeded: true });
  }

  /**
   * Space：在「最後一個選取區塊」之後插入同泳道空白區塊並進入行內編輯。
   * 與 ＋ 按鈕共用同一套交易模式（beginPending；命名/放棄由 Swimlane 的
   * commit/cancel 收尾成單一可復原步驟）。無選取則不動作。
   */
  function insertBlankAfterSelection(): void {
    const selected = rotationStore.selectedEntries; // 已依 1D 陣列時間序排列
    if (selected.length === 0) return;
    const last = selected[selected.length - 1];
    const character = characterStore.slots[last.slotIndex].character;
    if (!character) return; // 理論上選取區塊必有角色；保險防呆

    const afterIndex = rotationStore.entries.findIndex((e) => e.id === last.id);
    history.beginPending();
    const newId = rotationStore.addFreeformBlock(
      '',
      getElementColor(character.element),
      last.slotIndex,
      character.id,
      afterIndex,
    );
    // 改選中新區塊 → 連續 Enter 可依出場順序一路接續插入。
    rotationStore.selectBlocks([newId]);
    // 插入點可能在可視範圍外（如選取後捲走）→ 不在畫面內才跟隨鏡頭。
    scrollEntryIntoView(newId, { onlyIfNeeded: true });
    // 等新區塊渲染進泳道後再標記編輯（RotationBlock 會自動聚焦）。
    void nextTick(() => {
      rotationStore.startEditing(newId);
    });
  }

  /**
   * 泳道選取的物化：把「選中整條泳道」轉成「選取該泳道所有區塊」。
   * 讓刪除／剪貼簿／巡覽等既有快捷鍵零改動即可支援泳道選取語意
   * （selectBlocks 內會一併清掉泳道選取狀態）。空泳道＝物化後無選取，
   * 後續處理器自然 no-op。無泳道選取時為 no-op。
   */
  function materializeLaneSelection(): void {
    const lane = rotationStore.selectedLaneIndex;
    if (lane === null) return;
    rotationStore.selectBlocks(
      rotationStore.entries.filter((e) => e.slotIndex === lane).map((e) => e.id),
    );
  }

  /**
   * Space（泳道選取中）：於「全軸末尾」新增該泳道的空白區塊並進入行內編輯，
   * 自動捲入視野。交易模式與 ＋ 按鈕／insertBlankAfterSelection 一致。
   */
  function appendBlankToSelectedLane(): void {
    const lane = rotationStore.selectedLaneIndex;
    if (lane === null) return;
    const character = characterStore.slots[lane].character;
    if (!character) return;

    history.beginPending();
    const newId = rotationStore.addFreeformBlock(
      '',
      getElementColor(character.element),
      lane,
      character.id,
      rotationStore.entries.length - 1,
    );
    // 改選中新區塊（清掉泳道選取）→ 後續 Space/Enter 沿用區塊選取流程接續。
    rotationStore.selectBlocks([newId]);
    scrollEntryIntoView(newId, { onlyIfNeeded: true });
    void nextTick(() => {
      rotationStore.startEditing(newId);
    });
  }

  // ──────────────────────────────────────────
  // 快捷鍵表（宣告式 keymap）
  // ──────────────────────────────────────────

  /** 長按巡覽節流：重複事件（event.repeat）間隔未達 NAV_REPEAT_MS 時回 false；
   *  首次按下（非重複）不受限。A/D 與 W/S 共用。 */
  function _passNavRepeatThrottle(event: KeyboardEvent): boolean {
    if (!event.repeat) return true;
    const now = performance.now();
    if (now - _lastNavRepeatAt < NAV_REPEAT_MS) return false;
    _lastNavRepeatAt = now;
    return true;
  }

  /** Ctrl+單鍵組合的 matcher 工廠（不檢查 Shift，供 Ctrl+Shift+Z/S 等變體在 run 內分流）。 */
  const ctrlCombo =
    (letter: string) =>
    ({ key, isCtrl }: ShortcutContext) =>
      isCtrl && key.toLowerCase() === letter;

  const shortcuts: ShortcutDef[] = [
    // ── Delete / Backspace：刪除選取 ───────────────────────
    {
      matches: ({ key, isCtrl }) => (key === 'Delete' || key === 'Backspace') && !isCtrl,
      run: ({ event }) => {
        materializeLaneSelection(); // 泳道選取＝視同該泳道全部區塊被選取
        if (rotationStore.selectedIds.size > 0) {
          event.preventDefault();
          rotationStore.deleteSelectedBlocks();
        }
      },
    },

    // ── Enter：編輯選取區塊的文字（多選＝同步編輯）────────────
    // 與「提交編輯」無衝突：編輯中焦點在輸入框，Enter 由 RotationBlock 的
    // keydown 自行提交，且事件 target 為 input 會被 _shouldIgnore 提前排除，
    // 不會落到這裡；此表項只在「非編輯狀態、有選取」時進場。
    {
      matches: ({ event, key, isCtrl }) =>
        key === 'Enter' && !isCtrl && !event.altKey && !event.shiftKey,
      run: ({ event }) => {
        materializeLaneSelection(); // 泳道選取＝視同該泳道全部區塊被選取
        if (rotationStore.selectedIds.size > 0) {
          // preventDefault：焦點若停在按鈕（如 ＋）上，避免 Enter 同時觸發原生 click。
          event.preventDefault();
          editSelectedLabels();
        }
      },
    },

    // ── Space：在選取區塊後插入空白區塊 ─────────────────────
    // 有選取才攔截：preventDefault 擋掉 Space 的原生行為（頁面向下捲動、或焦點
    // 停在按鈕時觸發 click 造成雙重插入）。無選取則放行，保留原生捲動。
    {
      matches: ({ event, key, isCtrl }) =>
        key === ' ' && !isCtrl && !event.altKey && !event.shiftKey,
      run: ({ event }) => {
        // 泳道選取中：Space 改為「於全軸末尾新增該泳道區塊」（不做物化）。
        if (rotationStore.selectedLaneIndex !== null) {
          event.preventDefault();
          appendBlankToSelectedLane();
          return;
        }
        if (rotationStore.selectedIds.size > 0) {
          event.preventDefault();
          insertBlankAfterSelection();
        }
      },
    },

    // ── Escape：清除選取 ───────────────────────────────────
    {
      matches: ({ key }) => key === 'Escape',
      run: () => rotationStore.clearSelection(),
    },

    // ── F：進入熱鍵輸入模式（模式中的按鍵已在分派器前段短路，不會回到這）──
    {
      matches: ({ event, key, isCtrl }) =>
        key.toLowerCase() === 'f' && !isCtrl && !event.altKey && !event.shiftKey,
      run: ({ event }) => {
        event.preventDefault();
        hotkeyMode.enter();
      },
    },

    // ── Tab：展開／收合側邊欄 ───────────────────────────────
    // preventDefault 攔下瀏覽器預設的焦點切換（_shouldIgnore 已排除輸入元素，
    // 故在 input/textarea 內的 Tab 仍維持正常跳格）。
    {
      matches: ({ key, isCtrl }) => key === 'Tab' && !isCtrl,
      run: ({ event }) => {
        event.preventDefault();
        sidebarCollapse.toggle();
      },
    },

    // ── 區塊巡覽 A / D 與 ← / →（純鍵，無修飾鍵時才觸發；Ctrl+A/Ctrl+D 維持原行為）──
    // 長按時作業系統的鍵盤自動重複約 30ms 觸發一次，遠快於選中光暈的 0.15s
    // 過渡，導致每塊還沒亮起就跳走（看起來像「動畫一開始就被重置」）。
    // 對「重複事件（event.repeat）」節流至最短 NAV_REPEAT_MS，讓每一步的選中
    // 光暈有足夠時間浮現、肉眼能跟上焦點移動；首次按下（非重複）不受限。
    {
      matches: ({ event, key, isCtrl }) =>
        !isCtrl &&
        !event.altKey &&
        (key.toLowerCase() === 'a' || key === 'ArrowLeft' ||
          key.toLowerCase() === 'd' || key === 'ArrowRight'),
      run: ({ event, key }) => {
        event.preventDefault();
        if (!_passNavRepeatThrottle(event)) return;
        // 泳道選取中不物化：focusStep 對泳道選取有專屬行為（A→泳道尾塊、D→泳道頭塊）。
        nav.focusStep(key.toLowerCase() === 'a' || key === 'ArrowLeft' ? -1 : 1);
      },
    },

    // ── 泳道巡覽 W / S 與 ↑ / ↓（純鍵；上下循環選取整條泳道，清除區塊選取）──
    // 與 A/D 相同的長按節流，讓泳道高亮切換肉眼可跟。
    {
      matches: ({ event, key, isCtrl }) =>
        !isCtrl &&
        !event.altKey &&
        (key.toLowerCase() === 'w' || key === 'ArrowUp' ||
          key.toLowerCase() === 's' || key === 'ArrowDown'),
      run: ({ event, key }) => {
        event.preventDefault();
        if (!_passNavRepeatThrottle(event)) return;
        nav.focusLaneStep(key.toLowerCase() === 'w' || key === 'ArrowUp' ? -1 : 1);
      },
    },

    // ── Ctrl 組合鍵 ────────────────────────────────────────

    // Ctrl+Z：復原；Ctrl+Shift+Z：重做
    {
      matches: ctrlCombo('z'),
      run: ({ event }) => {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
      },
    },

    // Ctrl+Y：重做（Windows 慣例）
    {
      matches: ctrlCombo('y'),
      run: ({ event }) => {
        event.preventDefault();
        history.redo();
      },
    },

    // Ctrl+S：儲存變更；Ctrl+Shift+S：另存新檔（皆禁用瀏覽器預設的存檔行為）
    {
      matches: ctrlCombo('s'),
      run: ({ event }) => {
        event.preventDefault();
        if (event.shiftKey) teamManager.openSaveAs();
        else saveTeamShortcut();
      },
    },

    // Ctrl+C：複製（泳道選取＝視同該泳道全部區塊，下同）
    {
      matches: ctrlCombo('c'),
      run: ({ event }) => {
        event.preventDefault();
        materializeLaneSelection();
        clipboard.copySelected();
      },
    },

    // Ctrl+X：剪下
    {
      matches: ctrlCombo('x'),
      run: ({ event }) => {
        event.preventDefault();
        materializeLaneSelection();
        clipboard.cutSelected();
      },
    },

    // Ctrl+V：貼上
    {
      matches: ctrlCombo('v'),
      run: ({ event }) => {
        event.preventDefault();
        materializeLaneSelection();
        clipboard.paste();
      },
    },

    // Ctrl+D：向右複製（禁用瀏覽器預設的「加入書籤」行為）
    {
      matches: ctrlCombo('d'),
      run: ({ event }) => {
        event.preventDefault();
        materializeLaneSelection();
        clipboard.duplicateRight();
      },
    },

    // Ctrl+A：全選當前輸出軸的所有區塊（entries 即作用中軸的全部區塊，含三條泳道）
    {
      matches: ctrlCombo('a'),
      run: ({ event }) => {
        event.preventDefault();
        rotationStore.selectBlocks(rotationStore.entries.map((e) => e.id));
      },
    },
  ];

  // ──────────────────────────────────────────
  // 事件分派
  // ──────────────────────────────────────────

  /** 焦點在可輸入元素（input/textarea/select/contentEditable）時忽略快捷鍵。 */
  function _shouldIgnore(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return target.isContentEditable;
  }

  /** keydown 分派器：依表序比對，命中即執行並停止。 */
  function _handleKeydown(event: KeyboardEvent): void {
    if (_shouldIgnore(event)) return;

    // 熱鍵輸入模式中：既有快捷鍵全數停用，改由模式自己的分派器接管。
    if (hotkeyMode.active.value) {
      hotkeyMode.handleModeKeydown(event);
      return;
    }

    const isMac = navigator.userAgent.toUpperCase().includes('MAC OS');
    // Mac 使用 Meta（Command），Windows/Linux 使用 Ctrl
    const isCtrl = isMac ? event.metaKey : event.ctrlKey;
    const ctx: ShortcutContext = { event, key: event.key, isCtrl };

    for (const shortcut of shortcuts) {
      if (shortcut.matches(ctx)) {
        shortcut.run(ctx);
        return;
      }
    }
  }

  // ──────────────────────────────────────────
  // 生命週期掛載
  // ──────────────────────────────────────────

  /** keyup 分派器：僅熱鍵輸入模式需要（tap/hold 於放開時落子，見 §3.3）。 */
  function _handleKeyup(event: KeyboardEvent): void {
    if (!hotkeyMode.active.value) return;
    if (_shouldIgnore(event)) return;
    hotkeyMode.handleModeKeyup(event);
  }

  onMounted(() => {
    // 掛載到 window（而非 document），確保在所有場景下都能接收到事件
    window.addEventListener('keydown', _handleKeydown);
    window.addEventListener('keyup', _handleKeyup);
  });

  onUnmounted(() => {
    // 元件卸除時移除監聽器，防止記憶體洩漏
    window.removeEventListener('keydown', _handleKeydown);
    window.removeEventListener('keyup', _handleKeyup);
  });

  // 副作用全透過 store 反映，回傳空物件僅為呼叫端語意清晰。
  return {};
}

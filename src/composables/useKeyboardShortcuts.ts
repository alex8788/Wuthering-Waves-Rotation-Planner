// ============================================================
// useKeyboardShortcuts.ts — 全域鍵盤快捷鍵管理。
//
// 設計原則：onMounted/onUnmounted 自動掛/卸監聽器；只在根層級（App.vue）呼叫
//           一次，避免多元件重複觸發。
//
// 快捷鍵一覽：
//   A / D               → 區塊巡覽：逐塊向左／右循環選取（無選取時選最右／最左塊）
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
import { getElementColor } from '@/constants/elements';
import { t } from '@/i18n';

export function useKeyboardShortcuts() {
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

  // ──────────────────────────────────────────
  // 事件處理器
  // ──────────────────────────────────────────

  /** 焦點在可輸入元素（input/textarea/select/contentEditable）時忽略快捷鍵。 */
  function _shouldIgnore(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return target.isContentEditable;
  }

  /** keydown 核心：依按鍵組合分派操作。 */
  function _handleKeydown(event: KeyboardEvent): void {
    if (_shouldIgnore(event)) return;

    const isMac = navigator.userAgent.toUpperCase().includes('MAC OS');
    // Mac 使用 Meta（Command），Windows/Linux 使用 Ctrl
    const isCtrl = isMac ? event.metaKey : event.ctrlKey;
    const key = event.key;

    // ── Delete / Backspace：刪除選取 ───────────────────────
    if ((key === 'Delete' || key === 'Backspace') && !isCtrl) {
      if (rotationStore.selectedIds.size > 0) {
        event.preventDefault();
        rotationStore.deleteSelectedBlocks();
      }
      return;
    }

    // ── Enter：編輯選取區塊的文字（多選＝同步編輯）────────────
    // 與「提交編輯」無衝突：編輯中焦點在輸入框，Enter 由 RotationBlock 的
    // keydown 自行提交，且事件 target 為 input 會被 _shouldIgnore 提前排除，
    // 不會落到這裡；此分支只在「非編輯狀態、有選取」時進場。
    if (key === 'Enter' && !isCtrl && !event.altKey && !event.shiftKey) {
      if (rotationStore.selectedIds.size > 0) {
        // preventDefault：焦點若停在按鈕（如 ＋）上，避免 Enter 同時觸發原生 click。
        event.preventDefault();
        editSelectedLabels();
      }
      return;
    }

    // ── Space：在選取區塊後插入空白區塊 ─────────────────────
    // 有選取才攔截：preventDefault 擋掉 Space 的原生行為（頁面向下捲動、或焦點
    // 停在按鈕時觸發 click 造成雙重插入）。無選取則放行，保留原生捲動。
    if (key === ' ' && !isCtrl && !event.altKey && !event.shiftKey) {
      if (rotationStore.selectedIds.size > 0) {
        event.preventDefault();
        insertBlankAfterSelection();
      }
      return;
    }

    // ── Escape：清除選取 ───────────────────────────────────
    if (key === 'Escape') {
      rotationStore.clearSelection();
      return;
    }

    // ── Tab：展開／收合側邊欄 ───────────────────────────────
    // preventDefault 攔下瀏覽器預設的焦點切換（_shouldIgnore 已排除輸入元素，
    // 故在 input/textarea 內的 Tab 仍維持正常跳格）。
    if (key === 'Tab' && !isCtrl) {
      event.preventDefault();
      sidebarCollapse.toggle();
      return;
    }

    // ── 區塊巡覽 A / D（純鍵，無修飾鍵時才觸發；Ctrl+A/Ctrl+D 維持原行為）──
    if (!isCtrl && !event.altKey && key.toLowerCase() === 'a') {
      event.preventDefault();
      nav.focusStep(-1);
      return;
    }
    if (!isCtrl && !event.altKey && key.toLowerCase() === 'd') {
      event.preventDefault();
      nav.focusStep(1);
      return;
    }

    // ── Ctrl 組合鍵 ────────────────────────────────────────
    if (!isCtrl) return;

    switch (key.toLowerCase()) {
      // Ctrl+Z：復原；Ctrl+Shift+Z：重做
      case 'z': {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        break;
      }

      // Ctrl+Y：重做（Windows 慣例）
      case 'y': {
        event.preventDefault();
        history.redo();
        break;
      }

      // Ctrl+S：儲存變更；Ctrl+Shift+S：另存新檔（皆禁用瀏覽器預設的存檔行為）
      case 's': {
        event.preventDefault();
        if (event.shiftKey) teamManager.openSaveAs();
        else saveTeamShortcut();
        break;
      }

      // Ctrl+C：複製
      case 'c': {
        event.preventDefault();
        clipboard.copySelected();
        break;
      }

      // Ctrl+X：剪下
      case 'x': {
        event.preventDefault();
        clipboard.cutSelected();
        break;
      }

      // Ctrl+V：貼上
      case 'v': {
        event.preventDefault();
        clipboard.paste();
        break;
      }

      // Ctrl+D：向右複製（禁用瀏覽器預設的「加入書籤」行為）
      case 'd': {
        event.preventDefault();
        clipboard.duplicateRight();
        break;
      }

      // Ctrl+A：全選當前輸出軸的所有區塊（entries 即作用中軸的全部區塊，含三條泳道）
      case 'a': {
        event.preventDefault();
        rotationStore.selectBlocks(rotationStore.entries.map((e) => e.id));
        break;
      }

      default:
        break;
    }
  }

  // ──────────────────────────────────────────
  // 生命週期掛載
  // ──────────────────────────────────────────

  onMounted(() => {
    // 掛載到 window（而非 document），確保在所有場景下都能接收到事件
    window.addEventListener('keydown', _handleKeydown);
  });

  onUnmounted(() => {
    // 元件卸除時移除監聽器，防止記憶體洩漏
    window.removeEventListener('keydown', _handleKeydown);
  });

  // 副作用全透過 store 反映，回傳空物件僅為呼叫端語意清晰。
  return {};
}
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
//   Escape              → 清除所有選取
//   Tab                 → 展開／收合側邊欄
// ============================================================

import { onMounted, onUnmounted } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useClipboard } from '@/composables/useClipboard';
import { useBlockNavigation } from '@/composables/useBlockNavigation';
import { useSidebarCollapse } from '@/composables/useSidebarCollapse';
import { useHistory } from '@/composables/useHistory';

export function useKeyboardShortcuts() {
  const rotationStore = useRotationStore();
  const clipboard = useClipboard();
  const nav = useBlockNavigation();
  const sidebarCollapse = useSidebarCollapse();
  const history = useHistory();

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
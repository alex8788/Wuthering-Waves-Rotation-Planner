// ============================================================
// useKeyboardShortcuts.ts
// 全域鍵盤快捷鍵管理。
//
// 【設計說明】
// 使用 onMounted / onUnmounted 生命週期自動掛載與卸除監聽器。
// 此 composable 應只在「根層級元件（App.vue）」呼叫一次，
// 避免多個元件各自掛載而造成重複觸發。
//
// 快捷鍵一覽：
//   Delete / Backspace  → 刪除選取的區塊
//   Ctrl+C              → 複製選取的區塊
//   Ctrl+X              → 剪下選取的區塊
//   Ctrl+V              → 貼上剪貼簿內容
//   Ctrl+D              → 向右複製選取的區塊
//   Escape              → 清除所有選取
//   Tab                 → 展開／收合側邊欄
// ============================================================

import { onMounted, onUnmounted } from 'vue';
import { useRotationStore } from '@/stores/useRotationStore';
import { useClipboard } from '@/composables/useClipboard';
import { useSidebarCollapse } from '@/composables/useSidebarCollapse';

export function useKeyboardShortcuts() {
  const rotationStore = useRotationStore();
  const clipboard = useClipboard();
  const sidebarCollapse = useSidebarCollapse();

  // ──────────────────────────────────────────
  // 事件處理器
  // ──────────────────────────────────────────

  /**
   * _shouldIgnore：判斷是否應該忽略此次鍵盤事件。
   *
   * 當焦點在 input 或 textarea 等可輸入元素上時，
   * 快捷鍵不應該觸發（使用者正在輸入文字）。
   */
  function _shouldIgnore(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    const tag = target.tagName.toLowerCase();

    // 常見的可輸入元素標籤
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return true;
    }

    // contentEditable 元素（日後若實作區塊標籤的行內編輯）
    if (target.isContentEditable) {
      return true;
    }

    return false;
  }

  /**
   * _handleKeydown：keydown 事件的核心處理函式。
   * 根據按鍵組合分派到對應的操作。
   */
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

    // ── Ctrl 組合鍵 ────────────────────────────────────────
    if (!isCtrl) return;

    switch (key.toLowerCase()) {
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

      // Ctrl+A：全選當前選取區塊所在泳道的所有區塊（保留供未來擴充）
      // 目前版本僅清除選取，避免誤觸瀏覽器的「全選文字」行為
      case 'a': {
        event.preventDefault();
        // TODO Phase 4 後實作：全選同泳道區塊
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

  // 此 composable 不需要回傳任何狀態，副作用全部透過 store 反映
  // 回傳空物件是為了讓呼叫端語意清晰（明確知道這是在「使用」快捷鍵）
  return {};
}
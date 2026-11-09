import { vi } from 'vitest';

/**
 * 記錄畫面上出現過的進度環狀態（含同一輪就加上又拿掉的 class，靠 attributeOldValue 抓）。
 * collapsed＝縮成圓、check＝出現 ✓。
 */
export function watchActionRing(root: Node = document.body): {
  seen: Set<'ring' | 'collapsed' | 'check'>;
  stop(): void;
} {
  const seen = new Set<'ring' | 'collapsed' | 'check'>();
  const note = (className: string | null | undefined): void => {
    const names = String(className || '').split(/\s+/);
    if (names.includes('action-ring-btn')) seen.add('ring');
    if (names.includes('action-ring-btn') && names.includes('is-collapsed')) seen.add('collapsed');
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.attributeName === 'class') {
        note(record.oldValue);
        note((record.target as Element).getAttribute('class'));
      }
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.signup-ring-check') || node.querySelector('.signup-ring-check')) seen.add('check');
      }
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
  return { seen, stop: () => observer.disconnect() };
}

/** 模擬系統「減少動態」設定；呼叫端在 finally 以 vi.unstubAllGlobals() 還原。 */
export function stubReducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

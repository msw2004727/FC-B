import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useId, useRef } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { lockBody } from '@/ui/Modal';

/** 沿用 A perm-info DOM；內容均為 Preact 文字節點，背景不可穿透捲動。 */
export function RolesDialog({ title, children, footer, busy = false, onClose }: {
  title: string; children: ComponentChildren; footer: ComponentChildren;
  busy?: boolean; onClose: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };
  useEffect(() => {
    const previous = document.activeElement;
    const unlock = lockBody(document.body);
    const close = (): boolean => {
      if (!latest.current.busy) latest.current.onClose();
      return true;
    };
    const release = pushOverlay(close);
    const focusables = (): HTMLElement[] => Array.from(
      panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [],
    );
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) { event.preventDefault(); panel.current?.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const touch = (event: TouchEvent): void => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    const element = overlay.current;
    element?.addEventListener('touchmove', touch, { passive: false });
    document.addEventListener('keydown', keydown, true);
    panel.current?.focus();
    return () => {
      element?.removeEventListener('touchmove', touch);
      document.removeEventListener('keydown', keydown, true);
      release(); unlock();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div class="legacy-ui">
      <div ref={overlay} class="perm-info-overlay" onClick={event => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}>
        <div ref={panel} class="perm-info-dialog" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
          <div class="perm-info-dialog-title" id={id}>{title}</div>
          <div class="perm-info-dialog-body">{children}</div>
          <div class="role-perm-toolbar-actions">{footer}</div>
        </div>
      </div>
    </div>, document.body,
  );
}

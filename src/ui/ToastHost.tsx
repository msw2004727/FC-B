import './toast-host.css';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useState } from 'preact/hooks';
import {
  Toast,
  getToasts,
  subscribeToasts,
  toast,
  type ToastEntry,
} from '@/ui/Toast';
import { useT } from '@/i18n/i18n';

export interface ToastHostProps {
  /** 預設由 i18n 提供區域名稱。 */
  label?: string;
}

/**
 * M-040：取得目前最上層開啟的 `<dialog open>`；有的話把 Toast 掛進去，才不會被 native `showModal()` 蓋住。
 */
function getTopmostOpenDialog(): HTMLDialogElement | null {
  if (typeof document === 'undefined') return null;
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  return dialogs.length > 0 ? dialogs[dialogs.length - 1] ?? null : null;
}

export function ToastHost({ label }: ToastHostProps) {
  const t = useT();
  const [items, setItems] = useState<readonly ToastEntry[]>(getToasts);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? getTopmostOpenDialog() ?? document.body : null,
  );

  useLayoutEffect(() => {
    const sync = (): void => {
      setItems(getToasts());
      if (typeof document !== 'undefined') {
        setPortalTarget(getTopmostOpenDialog() ?? document.body);
      }
    };
    const unsubscribe = subscribeToasts(sync);
    // L-04：訂閱後補讀一次目前值
    sync();

    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
      return unsubscribe;
    }

    const observer = new MutationObserver(() => {
      const nextTarget = getTopmostOpenDialog() ?? document.body;
      setPortalTarget((prev) => (prev === nextTarget ? prev : nextTarget));
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });

    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, []);

  if (typeof document === 'undefined') return null;

  const current = items[items.length - 1];
  const target = portalTarget ?? document.body;

  return createPortal(
    <section
      class="ui-toast-host"
      aria-label={label ?? t('ui.toast.region')}
    >
      {current && (
        <Toast
          key={current.id}
          message={current.message}
          tone={current.tone}
          duration={current.duration}
          onClose={() => toast.dismiss(current.id)}
        />
      )}
    </section>,
    target,
  );
}

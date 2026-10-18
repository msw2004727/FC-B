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

export function ToastHost({ label }: ToastHostProps) {
  const t = useT();
  const [items, setItems] = useState<readonly ToastEntry[]>(getToasts);

  useLayoutEffect(() => {
    const sync = (): void => setItems(getToasts());
    const unsubscribe = subscribeToasts(sync);
    sync();
    return unsubscribe;
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <section
      class="ui-toast-host"
      aria-label={label ?? t('ui.toast.region')}
    >
      {items.map((item) => (
        <Toast
          key={item.id}
          message={item.message}
          tone={item.tone}
          duration={item.duration}
          onClose={() => toast.dismiss(item.id)}
        />
      ))}
    </section>,
    document.body,
  );
}

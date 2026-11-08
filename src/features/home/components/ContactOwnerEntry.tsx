import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { loadContactOwnerModal, type ContactOwnerModalComponent } from '../data/contact-owner-loader';
import { ContactOwnerFab } from './ContactOwnerFab';

export interface ContactOwnerEntryProps {
  signedIn: boolean;
}

/**
 * 首頁浮球。未登入走既有 signIn，不開彈窗、不載入彈窗。
 * 已登入才動態 import 彈窗（彈窗裡才帶 Callable）。
 */
export function ContactOwnerEntry({ signedIn }: ContactOwnerEntryProps): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [ModalComp, setModalComp] = useState<ContactOwnerModalComponent | null>(null);

  const onClick = (): void => {
    if (!signedIn) {
      void import('@/data/auth')
        .then((auth) => auth.signIn())
        .catch(() => undefined);
      return;
    }
    setOpen(true);
    if (ModalComp) return;
    loadContactOwnerModal().then(
      (component) => {
        setModalComp(() => component);
      },
      () => {
        setOpen(false);
        toast.show({ message: t('home.contactOwner.loadFailed') });
      },
    );
  };

  return (
    <>
      <ContactOwnerFab onClick={onClick} />
      {ModalComp ? <ModalComp open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

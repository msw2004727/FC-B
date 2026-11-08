import './contact-owner-modal.css';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { Modal } from '@/ui/Modal';
import { Text } from '@/ui/Text';
import {
  CONTACT_CONTACT_MAX,
  CONTACT_CONTENT_MAX,
  CONTACT_NAME_MAX,
  classifyContactSubmitError,
  contactCharCount,
  contactFieldErrors,
  contactInvalidField,
  submitContactMessage,
  type ContactField,
} from '../data/submit-contact-message';

const SENT_MS = 1600;
/** 輸入框硬上限取碼位上限的兩倍（＝後端原始長度防線）；實際上限由碼位驗證與計數器把關，emoji 才打得滿。 */
const INPUT_LIMIT_FACTOR = 2;

export interface ContactOwnerModalProps {
  open: boolean;
  onClose: () => void;
}

function CheckIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

export function ContactOwnerModal({ open, onClose }: ContactOwnerModalProps): JSX.Element {
  const t = useT();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [content, setContent] = useState('');
  const [errors, setErrors] = useState<readonly ContactField[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const sendingRef = useRef(false);
  const requestSeq = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const resetFields = (): void => {
    setName('');
    setContact('');
    setContent('');
    setErrors([]);
  };

  useEffect(() => {
    if (!sent) return undefined;
    const timer = setTimeout(() => {
      resetFields();
      setSent(false);
      onCloseRef.current();
    }, SENT_MS);
    return () => clearTimeout(timer);
  }, [sent]);

  // 卸載後丟掉進行中請求的結果；送出中不能關（Modal busy），關閉不再作廢請求。
  useEffect(() => () => {
    requestSeq.current += 1;
  }, []);

  const dismiss = (): void => {
    if (sendingRef.current) return;
    if (sent) {
      resetFields();
      setSent(false);
    }
    onClose();
  };

  const submit = async (): Promise<void> => {
    if (sendingRef.current || sent) return;
    const fieldErrors = contactFieldErrors({ name, contact, content });
    if (fieldErrors.length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors([]);
    const seq = requestSeq.current;
    sendingRef.current = true;
    setSending(true);
    try {
      await submitContactMessage({ name, contact, content });
      if (seq !== requestSeq.current) return;
      setSent(true);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const kind = classifyContactSubmitError(err);
      if (kind === 'unauthenticated') {
        let auth: typeof import('@/data/auth') | null = null;
        try {
          auth = await import('@/data/auth');
          if (seq !== requestSeq.current) return;
          await auth.signIn();
        } catch (signInErr) {
          // 導向 LINE／登入提示／已有登入者時 signIn 會丟 LoginRedirectingError，不算失敗（同 App.tsx）。
          if (seq === requestSeq.current && !auth?.isLoginRedirectingError(signInErr)) {
            toast.show({ message: t('home.contactOwner.failed') });
          }
        }
        return;
      }
      const field = contactInvalidField(err);
      if (field) setErrors([field]);
      toast.show({
        message: t(kind === 'rate_limited' ? 'home.contactOwner.rateLimited' : 'home.contactOwner.failed'),
      });
    } finally {
      if (seq === requestSeq.current) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  const invalid = (field: ContactField): true | undefined => (
    errors.includes(field) ? true : undefined
  );

  return (
    <Modal
      open={open}
      title={t('home.contactOwner.label')}
      class="contact-owner-modal"
      busy={sending}
      onClose={dismiss}
    >
      {sent ? (
        <div class="contact-owner-modal__done" role="status">
          <CheckIcon />
          <p><Text>{t('home.contactOwner.sent')}</Text></p>
        </div>
      ) : (
        <form
          class="contact-owner-modal__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit().catch(() => undefined);
          }}
        >
          <input
            type="text"
            name="name"
            placeholder={t('home.contactOwner.name')}
            aria-label={t('home.contactOwner.name')}
            maxLength={CONTACT_NAME_MAX * INPUT_LIMIT_FACTOR}
            value={name}
            aria-invalid={invalid('name')}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <input
            type="text"
            name="contact"
            placeholder={t('home.contactOwner.contact')}
            aria-label={t('home.contactOwner.contact')}
            maxLength={CONTACT_CONTACT_MAX * INPUT_LIMIT_FACTOR}
            value={contact}
            aria-invalid={invalid('contact')}
            onInput={(event) => setContact(event.currentTarget.value)}
          />
          <textarea
            name="content"
            placeholder={t('home.contactOwner.content')}
            aria-label={t('home.contactOwner.content')}
            maxLength={CONTACT_CONTENT_MAX * INPUT_LIMIT_FACTOR}
            value={content}
            aria-invalid={invalid('content')}
            onInput={(event) => setContent(event.currentTarget.value)}
          />
          <span class="contact-owner-modal__count">{contactCharCount(content)}／{CONTACT_CONTENT_MAX}</span>
          <button
            type="submit"
            class="contact-owner-modal__send"
            disabled={sending}
            aria-busy={sending || undefined}
          >
            <Text>{sending ? t('home.contactOwner.submitting') : t('home.contactOwner.submit')}</Text>
          </button>
        </form>
      )}
    </Modal>
  );
}

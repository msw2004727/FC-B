import type { ComponentType, JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { useT } from '@/i18n/i18n';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';
import type {
  ImageCropperOptions,
  ImageCropperProps,
} from '@/features/events/components/event-form/ImageCropper';
import {
  NAME_MAX,
  TOURNAMENT_CARD_TYPES,
  buildTournamentCardWrite,
  safeImageSrc,
  type TournamentCard,
  type TournamentCardWrite,
} from '../data/card-model';

export interface TournamentCardFormProps {
  /** 編輯的卡片；新增時 null。 */
  card: TournamentCard | null;
  busy: boolean;
  /** 驗證通過後呼叫；`imageDataUrl` 是新裁切的圖片（沒換圖時 null），由呼叫端上傳。 */
  onSubmit(write: TournamentCardWrite, imageDataUrl: string | null): void;
  onDelete(card: TournamentCard): void;
  onClose(): void;
}

type CropperModule = typeof import('@/features/events/components/event-form/ImageCropper');
let cropperModule: Promise<CropperModule> | null = null;

/** 裁圖元件只載入一次；失敗清掉快取，下次可重試。 */
function loadImageCropper(): Promise<CropperModule> {
  cropperModule ??= import('@/features/events/components/event-form/ImageCropper').catch(
    (error: unknown) => {
      cropperModule = null;
      throw error;
    },
  );
  return cropperModule;
}

// 與活動封面相同的檔案檢查（MIME 或副檔名任一符合，含 HEIC／HEIF；輸入檔上限 5MB）。
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const INPUT_FILE_MAX_BYTES = 5 * 1024 * 1024;

const CROP_OPTIONS: ImageCropperOptions = {
  aspectRatio: 8 / 3,
  outputWidth: 800,
  outputHeight: 300,
  outputType: 'image/webp',
  quality: 0.9,
  recommendedSize: '800 x 300',
  aspectLabel: '8:3',
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && result) resolve(result);
      else reject(new Error('image data URL unavailable'));
    };
    reader.onerror = () => reject(new Error('image file read failed'));
    reader.readAsDataURL(file);
  });
}

interface CropperState {
  Component: ComponentType<ImageCropperProps>;
  src: string;
}

/** 新增／編輯賽事卡片的彈窗（A 的 .modal 樣式）；編輯時另有刪除。 */
export function TournamentCardForm({
  card,
  busy,
  onSubmit,
  onDelete,
  onClose,
}: TournamentCardFormProps): JSX.Element {
  const t = useT();
  const [name, setName] = useState(card?.name ?? '');
  const [type, setType] = useState<string>(card?.type ?? '');
  const [startDate, setStartDate] = useState(card?.startDate ?? '');
  const [endDate, setEndDate] = useState(card?.endDate ?? '');
  const [url, setUrl] = useState(card?.url ?? '');
  const [newImage, setNewImage] = useState<string | null>(null);
  const [cropper, setCropper] = useState<CropperState | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const latest = useRef({ busy, onClose, t, cropperOpen: false });
  latest.current = { busy, onClose, t, cropperOpen: cropper !== null };

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  // 返回鍵、Esc 關閉；開著時鎖住背景捲動。儲存中不關閉；裁圖開著時交給裁圖元件處理。
  useEffect(() => {
    const unlock = lockBody(document.body);
    const requestClose = (): boolean => {
      if (latest.current.cropperOpen) return false;
      if (latest.current.busy) {
        toast.show({ message: latest.current.t('tournaments.form.saving'), tone: 'info' });
        return true;
      }
      latest.current.onClose();
      return true;
    };
    const releaseBack = pushOverlay(requestClose);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || latest.current.cropperOpen) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      releaseBack();
      unlock();
    };
  }, []);

  const clearFileInput = (): void => {
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickFile = async (file: File): Promise<void> => {
    const request = ++requestRef.current;
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_TYPES.includes(file.type.toLowerCase()) && !ALLOWED_EXTENSIONS.includes(extension)) {
      toast.show({ message: t('tournaments.toast.badType'), tone: 'error' });
      clearFileInput();
      return;
    }
    if (file.size > INPUT_FILE_MAX_BYTES) {
      toast.show({ message: t('tournaments.toast.tooBig'), tone: 'error' });
      clearFileInput();
      return;
    }
    try {
      const [src, module] = await Promise.all([readAsDataUrl(file), loadImageCropper()]);
      if (!mountedRef.current || request !== requestRef.current) return;
      setCropper({ Component: module.ImageCropper, src });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[tournaments] image prepare failed', err);
      if (!mountedRef.current || request !== requestRef.current) return;
      toast.show({ message: t('tournaments.toast.imageError'), tone: 'error' });
      clearFileInput();
    }
  };

  const requestClose = (): void => {
    if (busy) {
      toast.show({ message: t('tournaments.form.saving'), tone: 'info' });
      return;
    }
    onClose();
  };

  const handleSubmit = (): void => {
    if (busy) return;
    const result = buildTournamentCardWrite({ name, type, startDate, endDate, url });
    if (!result.ok) {
      toast.show({ message: t(`tournaments.error.${result.error}`), tone: 'error' });
      return;
    }
    onSubmit(result.write, newImage);
  };

  const previewSrc = newImage ?? safeImageSrc(card?.image);
  const openFilePicker = (): void => fileRef.current?.click();

  return createPortal(
    <div class="legacy-ui">
      <div class="modal-overlay open" aria-hidden="true" onClick={requestClose} />
      <div
        class="modal open"
        id="tournament-card-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tournament-card-modal-title"
      >
        <div class="modal-header">
          <h3 id="tournament-card-modal-title">
            {card ? t('tournaments.form.editTitle') : t('tournaments.form.createTitle')}
          </h3>
          <button
            type="button"
            class="modal-close"
            aria-label={t('tournaments.form.close')}
            onClick={requestClose}
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <div class="ce-form">
            <div class="ce-row tc-form-image">
              <label>{t('tournaments.form.image')}</label>
              <div class="ce-upload">
                <input
                  type="file"
                  id="tc-image"
                  accept=".jpg,.jpeg,.png,.webp,.heic,.heif"
                  hidden
                  ref={fileRef}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void pickFile(file);
                  }}
                />
                <div
                  class={`ce-upload-placeholder${previewSrc ? ' has-image' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={t('tournaments.form.imageUpload')}
                  onClick={openFilePicker}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openFilePicker();
                    }
                  }}
                >
                  {previewSrc ? (
                    <img src={previewSrc} alt="" />
                  ) : (
                    <>
                      <span class="ce-upload-icon">+</span>
                      <span class="ce-upload-text">{t('tournaments.form.imageUpload')}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div class="ce-row">
              <label for="tc-name">{t('tournaments.form.name')}</label>
              <input
                type="text"
                id="tc-name"
                maxLength={NAME_MAX}
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </div>
            <div class="ce-row">
              <label for="tc-type">{t('tournaments.form.type')}</label>
              <select
                id="tc-type"
                value={type}
                onChange={(event) => setType(event.currentTarget.value)}
              >
                <option value="" disabled>
                  {t('tournaments.form.type')}
                </option>
                {TOURNAMENT_CARD_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`tournaments.tab.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <div class="tc-form-dates">
              <div class="ce-row">
                <label for="tc-start">{t('tournaments.form.startDate')}</label>
                <input
                  type="date"
                  id="tc-start"
                  value={startDate}
                  onInput={(event) => setStartDate(event.currentTarget.value)}
                />
              </div>
              <div class="ce-row">
                <label for="tc-end">{t('tournaments.form.endDate')}</label>
                <input
                  type="date"
                  id="tc-end"
                  value={endDate}
                  min={startDate || undefined}
                  onInput={(event) => setEndDate(event.currentTarget.value)}
                />
              </div>
            </div>
            <div class="ce-row">
              <label for="tc-url">{t('tournaments.form.url')}</label>
              <input
                type="url"
                id="tc-url"
                inputMode="url"
                placeholder="https://"
                value={url}
                onInput={(event) => setUrl(event.currentTarget.value)}
              />
            </div>
            <div class="tc-form-actions">
              <button
                type="button"
                class="primary-btn full-width"
                id="tc-save"
                disabled={busy}
                onClick={handleSubmit}
              >
                {busy ? t('tournaments.form.saving') : t('tournaments.form.save')}
              </button>
              {card ? (
                <button
                  type="button"
                  class="danger-btn"
                  id="tc-delete"
                  disabled={busy}
                  onClick={() => onDelete(card)}
                >
                  {t('tournaments.form.delete')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {cropper ? (
        <cropper.Component
          src={cropper.src}
          options={{ ...CROP_OPTIONS, title: t('tournaments.form.image') }}
          onConfirm={(dataUrl) => {
            setNewImage(dataUrl);
            setCropper(null);
            clearFileInput();
          }}
          onCancel={() => {
            setCropper(null);
            clearFileInput();
          }}
        />
      ) : null}
    </div>,
    document.body,
  ) as JSX.Element;
}

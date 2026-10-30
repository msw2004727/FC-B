import type { ComponentType, JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import { useT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type {
  ImageCropperOptions,
  ImageCropperProps,
} from '@/features/events/components/event-form/ImageCropper';
import {
  DEFAULT_SUBTITLE_COLOR,
  DEFAULT_TITLE_COLOR,
  SLOT_NAME_MAX,
  SUBTITLE_MAX,
  TITLE_MAX,
  bannerImageSrc,
  buildBannerSave,
  toDatetimeLocal,
  type BannerFormInput,
  type BannerSaveWrite,
  type BannerSlot,
} from '../data/banner-model';

export interface BannerFormProps {
  slot: BannerSlot;
  saving: boolean;
  /** 驗證通過後呼叫；圖片若仍是 data URL，由呼叫端負責上傳。 */
  onSubmit(write: BannerSaveWrite): void | Promise<void>;
  onCancel(): void;
  /** 測試注入；預設取目前時間。 */
  now?: () => number;
}

type CropperModule = typeof import('@/features/events/components/event-form/ImageCropper');
let imageCropperModule: Promise<CropperModule> | null = null;

/** 裁圖元件只載入一次；載入失敗清掉快取，下一次選檔可重試（L-08）。 */
function loadImageCropper(): Promise<CropperModule> {
  imageCropperModule ??= import('@/features/events/components/event-form/ImageCropper').catch(
    (error: unknown) => {
      imageCropperModule = null;
      throw error;
    },
  );
  return imageCropperModule;
}

// A image-upload.js 的檔案檢查（MIME 或副檔名任一符合，含 HEIC／HEIF；輸入檔上限 5MB）。
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
const INPUT_FILE_MAX_BYTES = 5 * 1024 * 1024;

interface CropperState {
  Component: ComponentType<ImageCropperProps>;
  src: string;
}

/** 照 A `showBannerForm`／`saveBanner` 的編輯彈窗（DOM、id、class、欄位順序與文案相同）。 */
export function BannerForm({
  slot,
  saving,
  onSubmit,
  onCancel,
  now = Date.now,
}: BannerFormProps): JSX.Element {
  const t = useT();
  const isEmpty = slot.status === 'empty';
  // 標題列顯示用（隨語系翻譯）；寫進資料的預設名稱固定用中文「廣告位 {slot}」（F11：資料不跟著使用者語系走，同 A）。
  const slotLabel = slot.slotName || t('admin-banners.card.defaultSlotName', { slot: slot.slot });
  const isScheduled = slot.status === 'scheduled';

  const [slotName, setSlotName] = useState(slot.slotName || `廣告位 ${slot.slot}`);
  const [title, setTitle] = useState(slot.title);
  const [subtitle, setSubtitle] = useState(slot.subtitle);
  const [titleColor, setTitleColor] = useState(slot.titleColor || DEFAULT_TITLE_COLOR);
  const [subtitleColor, setSubtitleColor] = useState(slot.subtitleColor || DEFAULT_SUBTITLE_COLOR);
  const [linkUrl, setLinkUrl] = useState(slot.linkUrl);
  const [mode, setMode] = useState<'now' | 'scheduled'>(isScheduled ? 'scheduled' : 'now');
  const [publishLocal, setPublishLocal] = useState(
    isScheduled && slot.publishAt ? toDatetimeLocal(slot.publishAt) : '',
  );
  const [unpublishLocal, setUnpublishLocal] = useState(
    slot.unpublishAt ? toDatetimeLocal(slot.unpublishAt) : '',
  );
  const [image, setImage] = useState(slot.image);
  const [cropper, setCropper] = useState<CropperState | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const slotNameRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<FileReader | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const cropperOpenRef = useRef(false);
  cropperOpenRef.current = cropper !== null;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      const reader = readerRef.current;
      readerRef.current = null;
      if (reader?.readyState === 1) reader.abort();
    };
  }, []);

  // F13：彈窗開啟時聚焦第一個輸入框（A 的 `_openAdEditModal` 也在開啟後聚焦）。
  useEffect(() => {
    slotNameRef.current?.focus({ preventScroll: true });
  }, []);

  // 返回鍵、Esc 關閉；彈窗開著時鎖住 body 捲動（A 用 body.ad-edit-modal-open，見 admin-banners.css 說明）。
  useEffect(() => {
    const release = pushOverlay(() => {
      if (cropperOpenRef.current) return false;
      onCancelRef.current();
      return true;
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !cropperOpenRef.current) onCancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      release();
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const clearFileInput = useCallback((): void => {
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const onPickFile = useCallback(
    (file: File): void => {
      const request = ++requestRef.current;
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_TYPES.includes(file.type.toLowerCase()) && !ALLOWED_EXTENSIONS.includes(extension)) {
        toast.show({ message: t('admin-banners.image.badType'), tone: 'error' });
        clearFileInput();
        return;
      }
      if (file.size > INPUT_FILE_MAX_BYTES) {
        toast.show({ message: t('admin-banners.image.tooBig'), tone: 'error' });
        clearFileInput();
        return;
      }
      const reader = new FileReader();
      readerRef.current = reader;
      reader.onload = () => {
        if (readerRef.current === reader) readerRef.current = null;
        const result = reader.result;
        if (typeof result !== 'string' || request !== requestRef.current || !mountedRef.current) return;
        loadImageCropper()
          .then((module) => {
            if (request !== requestRef.current || !mountedRef.current) return;
            setCropper({ Component: module.ImageCropper, src: result });
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error('[banners] cropper load failed', err);
            if (request !== requestRef.current || !mountedRef.current) return;
            toast.show({ message: t('admin-banners.toast.imageProcessError'), tone: 'error' });
            clearFileInput();
          });
      };
      reader.onerror = () => {
        if (readerRef.current === reader) readerRef.current = null;
        if (request !== requestRef.current || !mountedRef.current) return;
        toast.show({ message: t('admin-banners.toast.imageProcessError'), tone: 'error' });
        clearFileInput();
      };
      reader.readAsDataURL(file);
    },
    [clearFileInput, t],
  );

  function handleSubmit(): void {
    const input: BannerFormInput = {
      slotName,
      title,
      subtitle,
      titleColor,
      subtitleColor,
      linkUrl,
      mode,
      publishLocal,
      unpublishLocal,
      image,
    };
    const result = buildBannerSave(input, now());
    if (!result.ok) {
      toast.show({ message: t(`admin-banners.error.${result.error}`), tone: 'error' });
      return;
    }
    Promise.resolve(onSubmit(result.write)).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[banners] submit failed', err);
    });
  }

  const cropOptions: ImageCropperOptions = {
    aspectRatio: 1200 / 545,
    outputWidth: 1200,
    outputHeight: 545,
    // T-046：A 預設 0.9，橫幅降到 0.72（尺寸不變）。
    quality: 0.72,
    title: t('admin-banners.cropper.title'),
    targetLabel: t('admin-banners.cropper.targetLabel'),
    recommendedSize: '1200 x 545',
    aspectLabel: '2.2:1',
  };

  // F12：預覽只顯示安全來源；`image` 狀態保留原值，沒換圖時儲存會原樣寫回。
  const previewSrc = bannerImageSrc(image);

  const formTitle = isEmpty
    ? t('admin-banners.form.setTitle', { slot: slotLabel })
    : t('admin-banners.form.editTitle', { slot: slotLabel });

  const body = (
    <div class="legacy-ui">
      <div
        class="ad-edit-modal-root is-open"
        aria-hidden="false"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onCancel();
        }}
      >
        <div
          class="form-card ad-edit-modal-card"
          id="banner-form-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="banner-form-title"
        >
          <div class="role-editor-header">
            <span id="banner-form-title">{formTitle}</span>
            <button type="button" class="text-btn" onClick={onCancel}>
              {t('admin-banners.form.cancel')}
            </button>
          </div>
          <div class="form-row">
            <label for="banner-slot-display">{t('admin-banners.form.slotName')}</label>
            <input
              type="text"
              id="banner-slot-display"
              placeholder={t('admin-banners.form.slotNamePlaceholder')}
              maxLength={SLOT_NAME_MAX}
              ref={slotNameRef}
              value={slotName}
              onInput={(event) => setSlotName(event.currentTarget.value)}
            />
          </div>
          <div class="form-row">
            <label>{t('admin-banners.form.image')}</label>
            <div class="ce-upload">
              <input
                type="file"
                id="banner-image"
                accept=".jpg,.jpeg,.png"
                hidden
                ref={fileRef}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) onPickFile(file);
                }}
              />
              <div
                class={`ce-upload-placeholder${previewSrc ? ' has-image' : ''}`}
                id="banner-preview"
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileRef.current?.click();
                  }
                }}
              >
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt=""
                    style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)"
                  />
                ) : (
                  <>
                    <span class="ce-upload-icon">+</span>
                    <span class="ce-upload-text">{t('admin-banners.form.imageUpload')}</span>
                    <span class="ce-upload-hint">{t('admin-banners.form.imageHint')}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div class="form-row">
            <label for="banner-input-title">{t('admin-banners.form.title')}</label>
            <input
              type="text"
              id="banner-input-title"
              placeholder={t('admin-banners.form.titlePlaceholder')}
              maxLength={TITLE_MAX}
              value={title}
              onInput={(event) => setTitle(event.currentTarget.value)}
            />
          </div>
          <div class="form-row">
            <label for="banner-input-subtitle">{t('admin-banners.form.subtitle')}</label>
            <input
              type="text"
              id="banner-input-subtitle"
              placeholder={t('admin-banners.form.subtitlePlaceholder')}
              maxLength={SUBTITLE_MAX}
              value={subtitle}
              onInput={(event) => setSubtitle(event.currentTarget.value)}
            />
          </div>
          <div class="form-row banner-text-color-row">
            <label>{t('admin-banners.form.colors')}</label>
            <div class="banner-color-inputs">
              <label>
                <span>{t('admin-banners.form.titleColor')}</span>
                <input
                  type="color"
                  id="banner-input-title-color"
                  value={titleColor}
                  onInput={(event) => setTitleColor(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>{t('admin-banners.form.subtitleColor')}</span>
                <input
                  type="color"
                  id="banner-input-subtitle-color"
                  value={subtitleColor}
                  onInput={(event) => setSubtitleColor(event.currentTarget.value)}
                />
              </label>
            </div>
          </div>
          <div class="form-row">
            <label for="banner-input-link">{t('admin-banners.form.link')}</label>
            <input
              type="text"
              id="banner-input-link"
              placeholder={t('admin-banners.form.linkPlaceholder')}
              value={linkUrl}
              onInput={(event) => setLinkUrl(event.currentTarget.value)}
            />
          </div>
          <div class="form-row">
            <label for="banner-input-mode">{t('admin-banners.form.mode')}</label>
            <select
              id="banner-input-mode"
              value={mode}
              onChange={(event) =>
                setMode(event.currentTarget.value === 'scheduled' ? 'scheduled' : 'now')
              }
            >
              <option value="now">{t('admin-banners.form.modeNow')}</option>
              <option value="scheduled">{t('admin-banners.form.modeScheduled')}</option>
            </select>
          </div>
          {mode === 'scheduled' ? (
            <div class="form-row" id="banner-publish-row">
              <label for="banner-input-publish">{t('admin-banners.form.publishAt')}</label>
              <input
                type="datetime-local"
                id="banner-input-publish"
                value={publishLocal}
                onInput={(event) => setPublishLocal(event.currentTarget.value)}
              />
            </div>
          ) : null}
          <div class="form-row">
            <label for="banner-input-unpublish">{t('admin-banners.form.unpublishAt')}</label>
            <input
              type="datetime-local"
              id="banner-input-unpublish"
              value={unpublishLocal}
              onInput={(event) => setUnpublishLocal(event.currentTarget.value)}
            />
          </div>
          <button
            type="button"
            class="primary-btn full-width"
            id="banner-form-save"
            disabled={saving}
            onClick={handleSubmit}
          >
            {saving ? t('admin-banners.form.saving') : t('admin-banners.form.save')}
          </button>
        </div>
      </div>
      {cropper ? (
        <cropper.Component
          src={cropper.src}
          options={cropOptions}
          onConfirm={(dataUrl) => {
            setImage(dataUrl);
            setCropper(null);
            clearFileInput();
          }}
          onCancel={() => {
            setCropper(null);
            clearFileInput();
          }}
        />
      ) : null}
    </div>
  );

  return createPortal(body, document.body) as JSX.Element;
}

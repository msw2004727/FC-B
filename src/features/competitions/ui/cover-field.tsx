// 賽事封面欄（建賽精靈第 1 步最上面、報隊管理「編輯賽事資訊」分類上面；計畫書第 6 題）。
// 選檔檢查與裁切沿用活動封面／外部賽事卡（ImageCropper 動態載入、8:3）；裁好立刻上傳（data/cover-upload.ts 也是動態載入），
// 上傳完才把兩個網址交給呼叫端：建賽是放進表單，報隊管理是直接呼叫 updateCompetition。
// 錯誤都畫在這一格（欄位錯誤樣式）；呼叫端的伺服器錯誤用 coverProblemText 轉成同一套句子後經 error 傳進來。

import type { ComponentType, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import type { ImageCropperOptions, ImageCropperProps } from '@/features/events/components/event-form/ImageCropper';
import type { UploadedCover } from '../data/cover-upload';
import type { CompetitionCover } from '../data/types';
import type { CompetitionsT } from '../i18n';
import { errorOf, reasonText } from './feedback';

/** 聚焦用的 id：沒封面是「上傳封面」框，有封面是「更換」（只能移除時是「移除」）。 */
export const COVER_FIELD_ID = 'cpf-cover';
const LABEL_ID = 'cpf-cover-l';

/** 封面＋本機預覽（上傳完成前後先顯示本機 data URL，不再下載一次）。 */
export interface CoverShown extends CompetitionCover {
  src?: string;
  thumbSrc?: string;
}

export type CoverUploader = (dataUrl: string) => Promise<UploadedCover>;

/** 後端 cover 欄的 field：cover、cover.url、cover.thumb。 */
export function isCoverField(field: unknown): boolean {
  return field === 'cover' || field === 'cover.url' || field === 'cover.thumb';
}

/** 封面相關的錯誤句。UNKNOWN_FIELD＝cpHost 還沒有封面欄（舊後端）；結構錯誤與網址不合格都請重新上傳。 */
export function coverProblemText(ct: CompetitionsT, reason: string, params?: Record<string, unknown>): string {
  switch (reason) {
    case 'COVER_BUSY':
      return ct('coverBusy');
    case 'UNKNOWN_FIELD':
      return ct('coverOff');
    case 'COMPETITION_CLOSED':
      return ct('coverClosed');
    case 'COVER_URL_NOT_ALLOWED':
    case 'FIELD_FORMAT':
    case 'FIELD_LENGTH':
    case 'FIELD_TYPE':
    case 'FIELD_REQUIRED':
      return ct('reason.COVER_URL_NOT_ALLOWED');
    default:
      return reasonText(ct, reason, params);
  }
}

type CropperModule = typeof import('@/features/events/components/event-form/ImageCropper');
let cropperModule: Promise<CropperModule> | null = null;

/** 裁圖元件只載入一次；失敗清掉快取，下次可重試（同外部賽事卡）。 */
function loadImageCropper(): Promise<CropperModule> {
  cropperModule ??= import('@/features/events/components/event-form/ImageCropper').catch((error: unknown) => {
    cropperModule = null;
    throw error;
  });
  return cropperModule;
}

const defaultUpload: CoverUploader = async (dataUrl) => (await import('../data/cover-upload')).uploadCompetitionCover(dataUrl);

// 與活動封面相同的檔案檢查（MIME 或副檔名任一符合，含 HEIC／HEIF；輸入檔上限 5MB）。
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
export const COVER_INPUT_MAX_BYTES = 5 * 1024 * 1024;

export const COVER_CROP: ImageCropperOptions = {
  aspectRatio: 8 / 3,
  outputWidth: 1200,
  outputHeight: 450,
  outputType: 'image/webp',
  quality: 0.72,
  recommendedSize: '1200 x 450',
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

function ImageIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 16l4.5-4.5 3 3L16 10l4 4M4 5h16v14H4z" />
    </svg>
  );
}

export function CoverField({
  ct,
  value,
  onChange,
  upload,
  removeOnly = false,
  error,
  onDirty,
  onBusyChange,
}: {
  ct: CompetitionsT;
  value: CoverShown | null;
  /** 上傳好（物件）或移除（null）。回 Promise 時等它完成；丟錯就把錯誤畫在這一格，畫面維持原本的封面。 */
  onChange: (next: CoverShown | null) => void | Promise<void>;
  upload?: CoverUploader;
  /** 已結束／已取消：後端只收移除，不畫更換。 */
  removeOnly?: boolean;
  /** 呼叫端的錯誤句（伺服器回的封面欄錯誤）。 */
  error?: string;
  /** 使用者開始選圖或移除：呼叫端清掉自己的封面錯誤。 */
  onDirty?: () => void;
  /** 上傳或儲存中（建賽精靈用來擋「下一步」）。 */
  onBusyChange?: (busy: boolean) => void;
}): JSX.Element | null {
  const [cropper, setCropper] = useState<{ Component: ComponentType<ImageCropperProps>; src: string } | null>(null);
  const [pending, setPending] = useState<{ kind: 'upload'; src: string } | { kind: 'remove' } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const busy = useRef(false);
  const onBusy = useRef(onBusyChange);
  onBusy.current = onBusyChange;

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      // 上傳中被卸載（例如報隊管理重新載入後不再畫這一格）：還給呼叫端「不忙」，免得它的按鈕一直擋著。
      if (busy.current) {
        busy.current = false;
        onBusy.current?.(false);
      }
    };
  }, []);

  function begin(next: typeof pending): void {
    setPending(next);
    busy.current = next != null;
    onBusyChange?.(next != null);
  }

  function clearFile(): void {
    if (fileRef.current) fileRef.current.value = '';
  }

  async function pickFile(file: File): Promise<void> {
    const id = ++request.current;
    onDirty?.();
    setLocalError(null);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_TYPES.includes(file.type.toLowerCase()) && !ALLOWED_EXTENSIONS.includes(ext)) {
      setLocalError(ct('coverBadType'));
      clearFile();
      return;
    }
    if (file.size > COVER_INPUT_MAX_BYTES) {
      setLocalError(ct('coverTooBig'));
      clearFile();
      return;
    }
    try {
      const [src, mod] = await Promise.all([readAsDataUrl(file), loadImageCropper()]);
      if (mounted.current && id === request.current) setCropper({ Component: mod.ImageCropper, src });
    } catch {
      if (mounted.current && id === request.current) setLocalError(ct('coverFailed'));
    }
    clearFile();
  }

  async function cropped(dataUrl: string): Promise<void> {
    setCropper(null);
    const id = ++request.current;
    begin({ kind: 'upload', src: dataUrl });
    try {
      let up: UploadedCover;
      try {
        up = await (upload ?? defaultUpload)(dataUrl);
      } catch (err) {
        // 只印 CoverUploadError 的 code（format／too-large／image／upload／timeout），不印訊息或網址（網址帶 token）。
        // 用 name 判斷而不 import 類別：cover-upload 是動態載入，不拉進這一包。
        const code = err instanceof Error && err.name === 'CoverUploadError' ? (err as Error & { code?: unknown }).code : undefined;
        console.warn('[cover] upload failed', typeof code === 'string' ? code : 'unknown');
        if (mounted.current && id === request.current) setLocalError(ct(code === 'timeout' ? 'coverTimeout' : 'coverFailed'));
        return;
      }
      if (!mounted.current || id !== request.current) return;
      try {
        await onChange({ url: up.url, thumb: up.thumb, src: dataUrl, thumbSrc: up.thumbSrc });
      } catch (err) {
        const info = errorOf(err);
        if (mounted.current) setLocalError(coverProblemText(ct, info.reason, info.params));
      }
    } finally {
      if (mounted.current && id === request.current) begin(null);
    }
  }

  async function remove(): Promise<void> {
    if (pending) return;
    onDirty?.();
    setLocalError(null);
    begin({ kind: 'remove' });
    try {
      await onChange(null);
    } catch (err) {
      const info = errorOf(err);
      if (mounted.current) setLocalError(coverProblemText(ct, info.reason, info.params));
    } finally {
      if (mounted.current) begin(null);
    }
  }

  const src = pending?.kind === 'upload' ? pending.src : value ? (value.src ?? value.url) : null;
  if (!src && removeOnly) return null;
  const thumb = value ? (value.thumbSrc ?? value.thumb) : null;
  const text = error ?? localError;
  const open = (): void => fileRef.current?.click();
  const described = text ? `${COVER_FIELD_ID}-error` : undefined;

  return (
    <>
      <div class={`ui-input cpc${text ? ' ui-input--error' : ''}`}>
        <label id={LABEL_ID}>{ct('cover')}</label>
        {src ? (
          <div class="cpc-pic">
            <img src={src} alt="" width={1200} height={450} />
            {pending?.kind === 'upload' ? (
              <span id={COVER_FIELD_ID} class="cpc-busy" role="status" tabIndex={-1}>
                <svg data-field-spinner width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-8-8" />
                </svg>
                {ct('coverUploading')}
              </span>
            ) : null}
          </div>
        ) : (
          <button type="button" id={COVER_FIELD_ID} class="cpc-drop" aria-labelledby={`${LABEL_ID} ${COVER_FIELD_ID}`} aria-describedby={described} onClick={open}>
            <ImageIcon />
            <span>{ct('coverUpload')}</span>
          </button>
        )}
        {src && pending?.kind !== 'upload' ? (
          <div class="cpc-acts">
            {thumb ? <img src={thumb} alt="" width={56} height={42} /> : null}
            {removeOnly ? null : (
              <Button id={COVER_FIELD_ID} variant="secondary" size="sm" disabled={pending != null} aria-describedby={described} onClick={open}>
                {ct('coverChange')}
              </Button>
            )}
            <Button
              id={removeOnly ? COVER_FIELD_ID : undefined}
              variant="secondary"
              size="sm"
              loading={pending?.kind === 'remove'}
              disabled={pending != null}
              aria-describedby={removeOnly ? described : undefined}
              onClick={() => { void remove(); }}
            >
              {ct('coverRemove')}
            </Button>
          </div>
        ) : null}
        {text ? <div id={`${COVER_FIELD_ID}-error`} data-field-error aria-live="polite">{text}</div> : null}
      </div>
      {removeOnly ? null : (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void pickFile(file);
          }}
        />
      )}
      {cropper ? (
        <cropper.Component
          src={cropper.src}
          options={COVER_CROP}
          onConfirm={(dataUrl) => { void cropped(dataUrl); }}
          onCancel={() => setCropper(null)}
        />
      ) : null}
    </>
  );
}

import type { ComponentType, JSX } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { EventImageVariants } from '../../data/event-create';
import type { CoverUploadView } from '../event-form/form-types';
import type { ImageCropperOptions, ImageCropperProps } from './ImageCropper';

export interface CoverUploadValue {
  image: string;
  imageVariants?: EventImageVariants;
}

interface CropSequence {
  request: number;
  source: string;
  index: 0 | 1;
  cover?: string;
  Component: ComponentType<ImageCropperProps>;
}

/** 裁圖元件只載入一次（連續選檔共用同一個動態 import；PM 修正：併發 import 在測試會拿到未 mock 的模組）。 */
let imageCropperModule: Promise<typeof import('./ImageCropper')> | null = null;
function loadImageCropper(): Promise<typeof import('./ImageCropper')> {
  imageCropperModule ??= import('./ImageCropper').catch((error: unknown) => {
    imageCropperModule = null;
    throw error;
  });
  return imageCropperModule;
}

/** 照 A bindEventImageVariantUpload 與 _openImageVariantCropSequence。 */
export function useCoverUpload(): {
  view: CoverUploadView;
  cropper: JSX.Element | null;
  value: CoverUploadValue;
  reset(initial: CoverUploadValue): void;
} {
  const lt = useLegacyT();
  const mounted = useRef(true);
  const requestId = useRef(0);
  const step = useRef(0);
  const readerRef = useRef<FileReader | null>(null);
  const [value, setValue] = useState<CoverUploadValue>({ image: '' });
  const [sequence, setSequence] = useState<CropSequence | null>(null);

  const clearInput = useCallback(() => {
    // 照 A bindEventImageVariantUpload：清空已知表單 input，允許重選同一檔案。
    const input = document.getElementById('ce-image');
    if (input instanceof HTMLInputElement) input.value = '';
  }, []);

  const abortReader = useCallback(() => {
    const reader = readerRef.current;
    readerRef.current = null;
    if (reader?.readyState === 1) reader.abort();
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      abortReader();
    };
  }, [abortReader]);

  const reset = useCallback((initial: CoverUploadValue) => {
    if (!mounted.current) return;
    requestId.current += 1;
    step.current = 0;
    abortReader();
    setSequence(null);
    // 照 A editEvent：預覽採 cover；只有重新裁圖才帶新 variants。
    setValue({ image: initial.imageVariants?.cover || initial.image });
    clearInput();
  }, [abortReader, clearInput]);

  const onPickFile = useCallback((file: File) => {
    if (!mounted.current) return;
    const request = ++requestId.current;
    step.current = 0;
    abortReader();
    setSequence(null);

    // 照 A _isAllowedImageFile：MIME 或副檔名任一符合即可，含 HEIC／HEIF。
    const types = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!types.includes(file.type.toLowerCase()) && !extensions.includes(extension)) {
      toast.show({
        message: lt('請上傳 JPG / PNG / WebP 圖片', '請上傳 JPG / PNG / WebP 圖片'),
        tone: 'error',
      });
      clearInput();
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.show({
        message: lt('圖片太大，不能超過 5MB', '圖片太大，不能超過 5MB'),
        tone: 'error',
      });
      clearInput();
      return;
    }

    const readFile = new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      readerRef.current = reader;

      const detach = () => {
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
        if (readerRef.current === reader) readerRef.current = null;
      };

      reader.onload = () => {
        const result = reader.result;
        detach();
        if (typeof result === 'string' && result) resolve(result);
        else reject(new Error('Image data URL unavailable'));
      };
      reader.onerror = () => {
        detach();
        reject(new Error('Image file read failed'));
      };
      reader.onabort = () => {
        detach();
        reject(new Error('Image file read aborted'));
      };

      try {
        reader.readAsDataURL(file);
      } catch (error) {
        detach();
        reject(error);
      }
    });

    // 照 A 延遲開啟裁圖：選到有效檔案後才載入元件與 CSS。
    Promise.all([readFile, loadImageCropper()])
      .then(([source, module]) => {
        if (!mounted.current || request !== requestId.current) return;
        setSequence({
          request,
          source,
          index: 0,
          Component: module.ImageCropper,
        });
      })
      .catch(() => {
        if (!mounted.current || request !== requestId.current) return;
        abortReader();
        toast.show({
          message: lt('圖片處理失敗，請重試', '圖片處理失敗，請重試'),
          tone: 'error',
        });
        clearInput();
      });
  }, [abortReader, clearInput, lt]);

  let cropper: JSX.Element | null = null;
  if (sequence) {
    const { Component, request, index } = sequence;
    const options: ImageCropperOptions = index === 0 ? {
      aspectRatio: 8 / 3,
      outputWidth: 1200,
      outputHeight: 450,
      title: `${lt('活動封面', '活動封面')} 1/2`,
      subtitle: lt(
        '會用在活動詳細頁、活動卡片與分享預覽。',
        '會用在活動詳細頁、活動卡片與分享預覽。',
      ),
      targetLabel: lt('活動封面', '活動封面'),
      recommendedSize: '800 x 300',
      aspectLabel: '8:3',
      confirmText: lt('下一步', '下一步'),
    } : {
      aspectRatio: 4 / 3,
      outputWidth: 1000,
      outputHeight: 750,
      title: `${lt('首頁下一場活動', '首頁下一場活動')} 2/2`,
      subtitle: lt(
        '會用在首頁「我的下一場活動」圖片區。',
        '會用在首頁「我的下一場活動」圖片區。',
      ),
      targetLabel: lt('首頁下一場', '首頁下一場'),
      recommendedSize: '800 x 600',
      aspectLabel: '4:3',
      confirmText: lt('完成', '完成'),
    };
    options.outputType = 'image/webp';
    options.quality = 0.9;
    options.maxZoom = 5;
    options.cancelText = lt('取消', '取消');

    cropper = (
      <Component
        key={`${request}:${index}`}
        src={sequence.source}
        options={options}
        onConfirm={(dataUrl) => {
          if (!mounted.current || request !== requestId.current || step.current !== index) return;
          step.current += 1;
          if (index === 0) {
            setSequence({ ...sequence, index: 1, cover: dataUrl });
            return;
          }
          const variants: EventImageVariants = {
            cover: sequence.cover,
            homeNext: dataUrl,
          };
          requestId.current += 1;
          setValue({
            image: variants.cover || variants.homeNext || '',
            imageVariants: variants,
          });
          setSequence(null);
        }}
        onCancel={() => {
          if (!mounted.current || request !== requestId.current || step.current !== index) return;
          requestId.current += 1;
          setSequence(null);
          // 照 A onCancel：清空 variants，保留原預覽。
          setValue((previous) => ({ image: previous.image }));
          clearInput();
        }}
      />
    );
  }

  return {
    view: { previewUrl: value.image, onPickFile },
    cropper,
    value,
    reset,
  };
}

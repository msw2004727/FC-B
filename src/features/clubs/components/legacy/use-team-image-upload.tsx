/**
 * 對應 A team-detail.js:347-618：
 * openTeamAvatarUpload／openTeamCoverUpload、_readTeamAvatarFileAsDataUrl、
 * _getTeamAvatarCropOptions、_prepareTeamAvatarDataUrl／_prepareTeamCoverPayload、
 * _uploadTeamAvatarFile／_uploadTeamCoverFile。
 * 檔檢對應 image-upload.js:84-100；裁切順序對應 :155-220。
 * 封面上傳對應 firebase-crud.js:2131-2160 的 _uploadTeamImageVariants，
 * 並共用與 A _uploadImage 相同的上傳路徑：
 * images/teams/{teamId}_avatar_{ms}、
 * images/teams/{teamId}_cover_{ms}、images/teams/{teamId}_card_{ms}。
 * 與 A 相同，沒有新增 Storage 路徑。
 * 頭像寫 avatarUrl；封面寫 image＋imageVariants{cover,card}；
 * 皆含 updatedAt，由 teams-write 加入。
 * 舊圖不刪除（Storage Rules `allow delete: if false`）。
 */
import type { ComponentType, JSX } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { uploadImageDataUrl } from '@/features/events/data/event-cover-upload';
import type {
  ImageCropperOptions,
  ImageCropperProps,
} from '@/features/events/components/event-form/ImageCropper';
import { toast } from '@/ui/Toast';
import { canEditTeamSettings } from '../../club-policy';
import { saveTeamAvatar, saveTeamCover } from '../../data/teams-write';
import type { ClubViewer, TeamDoc } from '../../data/types';

export type TeamImageKind = 'avatar' | 'cover';

export interface UseTeamImageUploadOptions {
  team: TeamDoc | null;
  viewer: ClubViewer;
  /** 寫入成功後呼叫（父層重讀 team）；回傳 Promise 時 hook 會等它。 */
  onSaved: (kind: TeamImageKind) => void | Promise<void>;
}

export interface TeamImageUploadApi {
  /** 開啟選檔（A：openTeamAvatarUpload／openTeamCoverUpload）。 */
  pick: (kind: TeamImageKind) => void;
  /** 目前正在上傳的種類；沒有則 null。 */
  busyKind: TeamImageKind | null;
  /** 隱藏的檔案 input 與裁切器，由父層渲染。 */
  overlay: JSX.Element | null;
}

interface Selection extends UseTeamImageUploadOptions {
  team: TeamDoc;
  kind: TeamImageKind;
}

interface CropSequence {
  request: number;
  selection: Selection;
  source: string;
  index: 0 | 1;
  cover?: string;
  Component: ComponentType<ImageCropperProps>;
}

let imageCropperModule:
  | Promise<typeof import('@/features/events/components/event-form/ImageCropper')>
  | null = null;

/** 共用單例；載入失敗時清除快取，允許下一次選檔重試。 */
function loadImageCropper(): Promise<
  typeof import('@/features/events/components/event-form/ImageCropper')
> {
  imageCropperModule ??= import(
    '@/features/events/components/event-form/ImageCropper'
  ).catch((error: unknown) => {
    imageCropperModule = null;
    throw error;
  });
  return imageCropperModule;
}

function cropOptions(kind: TeamImageKind, index: 0 | 1): ImageCropperOptions {
  const common: ImageCropperOptions = {
    outputType: 'image/webp',
    quality: 0.9,
    maxZoom: 5,
    cancelText: '取消',
  };

  if (kind === 'avatar') {
    return {
      ...common,
      aspectRatio: 1,
      outputWidth: 900,
      outputHeight: 900,
      title: '俱樂部頭像',
      subtitle: '請將圖片放在方形範圍內，完成後會直接作為俱樂部頭像。',
      targetLabel: '俱樂部頭像',
      recommendedSize: '900 x 900',
      aspectLabel: '1:1',
    };
  }

  return index === 0
    ? {
        ...common,
        aspectRatio: 8 / 3,
        outputWidth: 1200,
        outputHeight: 450,
        title: '俱樂部內頁封面 1/2',
        subtitle: '會用在俱樂部詳情頁上方的寬版封面。',
        targetLabel: '內頁封面',
        recommendedSize: '800 x 300',
        aspectLabel: '8:3',
        confirmText: '下一步',
      }
    : {
        ...common,
        aspectRatio: 1,
        outputWidth: 1000,
        outputHeight: 1000,
        title: '俱樂部卡片 2/2',
        subtitle: '會用在俱樂部列表與卡片型縮圖。',
        targetLabel: '俱樂部卡片',
        recommendedSize: '800 x 800',
        aspectLabel: '1:1',
        confirmText: '完成',
      };
}

export function useTeamImageUpload(
  options: UseTeamImageUploadOptions,
): TeamImageUploadApi {
  const { team, viewer, onSaved } = options;
  const mounted = useRef(true);
  const requestId = useRef(0);
  const step = useRef(0);
  const locked = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<FileReader | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const [busyKind, setBusyKind] = useState<TeamImageKind | null>(null);
  const [sequence, setSequence] = useState<CropSequence | null>(null);

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
      selectionRef.current = null;
      abortReader();
    };
  }, [abortReader]);

  const pick = useCallback((kind: TeamImageKind): void => {
    if (!team || !mounted.current) return;
    if (!canEditTeamSettings(viewer, team)) {
      toast.show({ message: '您沒有編輯此俱樂部的權限', tone: 'error' });
      return;
    }
    if (busyKind !== null || locked.current) return;
    const input = inputRef.current;
    if (!input) return;

    requestId.current += 1;
    step.current = 0;
    abortReader();
    setSequence(null);
    selectionRef.current = { kind, team, viewer, onSaved };
    input.value = '';
    input.click();
  }, [team, viewer, onSaved, busyKind, abortReader]);

  const onChange = useCallback((event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !mounted.current || locked.current) return;

    const selection = selectionRef.current;
    if (!selection) return;

    const request = ++requestId.current;
    step.current = 0;
    abortReader();
    setSequence(null);

    // 使用與按鈕一致的 helper，不自行推導隊長或角色權限。
    if (!team || !canEditTeamSettings(viewer, team)) {
      toast.show({ message: '您沒有編輯此俱樂部的權限', tone: 'error' });
      return;
    }

    const types = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!types.includes(file.type.toLowerCase()) && !extensions.includes(extension)) {
      toast.show({ message: '請上傳 JPG / PNG / WebP 圖片', tone: 'error' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.show({ message: '圖片太大，不能超過 5MB', tone: 'error' });
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

    Promise.all([readFile, loadImageCropper()])
      .then(([source, module]) => {
        if (!mounted.current || request !== requestId.current) return;
        setSequence({
          request,
          selection,
          source,
          index: 0,
          Component: module.ImageCropper,
        });
      })
      .catch((error: unknown) => {
        if (!mounted.current || request !== requestId.current) return;
        abortReader();
        console.error('[useTeamImageUpload]', error);
        toast.show({ message: '圖片處理失敗，請重試', tone: 'error' });
      });
  }, [abortReader, team, viewer]);

  const upload = async (current: CropSequence, dataUrl: string): Promise<void> => {
    const { request, selection } = current;
    const { kind, team: target, onSaved: saved } = selection;
    const active = () => mounted.current && request === requestId.current;

    try {
      const teamId = String(target.id ?? target._docId ?? '');
      if (!teamId) throw new Error('TEAM_ID_REQUIRED');

      if (kind === 'avatar') {
        const url = await uploadImageDataUrl(dataUrl, `teams/${teamId}_avatar`);
        if (!url) throw new Error('TEAM_AVATAR_UPLOAD_FAILED');
        if (!active()) return;
        await saveTeamAvatar(target, url);
      } else {
        if (!current.cover) throw new Error('TEAM_COVER_DATA_REQUIRED');
        const coverUrl = await uploadImageDataUrl(current.cover, `teams/${teamId}_cover`);
        if (!coverUrl) throw new Error('TEAM_COVER_UPLOAD_FAILED');
        if (!active()) return;

        const cardUrl = await uploadImageDataUrl(dataUrl, `teams/${teamId}_card`);
        if (!cardUrl) throw new Error('TEAM_CARD_UPLOAD_FAILED');
        if (!active()) return;

        await saveTeamCover(target, {
          image: coverUrl,
          imageVariants: { cover: coverUrl, card: cardUrl },
        });
      }

      if (!active()) return;
      toast.show({
        message: kind === 'avatar' ? '俱樂部頭像已更新' : '俱樂部封面已更新',
        tone: 'success',
      });
      try {
        await saved(kind);
      } catch (error) {
        // 資料已成功寫入；重讀失敗不得改成上傳失敗提示。
        console.error('[useTeamImageUpload]', error);
      }
    } catch (error) {
      console.error('[useTeamImageUpload]', error);
      if (active()) {
        toast.show({
          message: kind === 'avatar'
            ? '頭像上傳失敗，請稍後再試'
            : '封面上傳失敗，請稍後再試',
          tone: 'error',
        });
      }
    } finally {
      locked.current = false;
      if (active()) setBusyKind(null);
    }
  };

  let cropper: JSX.Element | null = null;
  if (sequence && busyKind === null) {
    const { Component, request, index, selection } = sequence;
    const isCurrent = () =>
      mounted.current &&
      request === requestId.current &&
      step.current === index &&
      !locked.current;

    cropper = (
      <Component
        key={`${request}:${index}`}
        src={sequence.source}
        options={cropOptions(selection.kind, index)}
        onConfirm={(dataUrl) => {
          if (!isCurrent()) return;
          if (!team || !canEditTeamSettings(viewer, team)) {
            requestId.current += 1;
            setSequence(null);
            toast.show({ message: '您沒有編輯此俱樂部的權限', tone: 'error' });
            return;
          }

          step.current += 1;
          if (selection.kind === 'cover' && index === 0) {
            setSequence({ ...sequence, index: 1, cover: dataUrl });
            return;
          }

          locked.current = true;
          setBusyKind(selection.kind);
          setSequence(null);
          selectionRef.current = null;
          upload(sequence, dataUrl).catch((error: unknown) => {
            // 防止事件啟動的 Promise 出現未處理拒絕。
            console.error('[useTeamImageUpload]', error);
          });
        }}
        onCancel={() => {
          if (!isCurrent()) return;
          requestId.current += 1;
          selectionRef.current = null;
          setSequence(null);
        }}
      />
    );
  }

  return {
    pick,
    busyKind,
    overlay: (
      <>
        <input
          type="file"
          accept="image/*"
          hidden
          style="display:none"
          ref={inputRef}
          onChange={onChange}
        />
        {cropper}
      </>
    ),
  };
}

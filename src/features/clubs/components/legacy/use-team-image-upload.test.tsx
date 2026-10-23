/**
 * 對應 A team-detail.js:347-618、image-upload.js:84-100／155-220，
 * 以及 firebase-crud.js:2131-2160 的頭像／封面流程契約測試。
 * Storage 沿用 images/teams/{teamId}_avatar_{ms}、
 * images/teams/{teamId}_cover_{ms}、images/teams/{teamId}_card_{ms}；
 * 與 A 相同，沒有新增 Storage 路徑。
 * 頭像寫 avatarUrl；封面寫 image＋imageVariants{cover,card}；
 * updatedAt 由 teams-write 加入。
 * 舊圖不刪除（Storage Rules `allow delete: if false`）。
 * 本檔依附件產出，尚未在專案環境執行。
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ImageCropperOptions,
  ImageCropperProps,
} from '@/features/events/components/event-form/ImageCropper';
import { uploadImageDataUrl } from '@/features/events/data/event-cover-upload';
import { toast } from '@/ui/Toast';
import { canEditTeamSettings } from '../../club-policy';
import { saveTeamAvatar, saveTeamCover } from '../../data/teams-write';
import type { ClubViewer, TeamDoc } from '../../data/types';
import {
  useTeamImageUpload,
  type TeamImageKind,
  type UseTeamImageUploadOptions,
} from './use-team-image-upload';

const cropperLog = vi.hoisted(() => ({
  options: [] as ImageCropperOptions[],
  props: [] as ImageCropperProps[],
}));

vi.mock('@/features/events/data/event-cover-upload', () => ({
  uploadImageDataUrl: vi.fn(),
}));
vi.mock('../../data/teams-write', () => ({
  saveTeamAvatar: vi.fn(),
  saveTeamCover: vi.fn(),
}));
vi.mock('../../club-policy', () => ({
  canEditTeamSettings: vi.fn(),
}));
vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));
vi.mock('@/features/events/components/event-form/ImageCropper', () => ({
  ImageCropper: (props: ImageCropperProps) => {
    cropperLog.options.push(props.options);
    cropperLog.props.push(props);
    return (
      <div data-testid="cropper">
        <span>{props.options.title}</span>
        <button onClick={() => props.onConfirm('data:image/webp;base64,AAAA')}>
          確認
        </button>
        <button onClick={() => props.onCancel()}>取消</button>
      </div>
    );
  },
}));

const DATA_URL = 'data:image/webp;base64,AAAA';
const AVATAR_URL = 'https://example.test/avatar.webp';
const COVER_URL = 'https://example.test/cover.webp';
const CARD_URL = 'https://example.test/card.webp';
const team: TeamDoc = { id: 'tm_test_1', _docId: 'tm_test_1' };
const viewer: ClubViewer = {
  uid: 'U-test-1',
  teamIds: new Set(['tm_test_1']),
  hasPermission: () => false,
};

function Harness(props: UseTeamImageUploadOptions) {
  const api = useTeamImageUpload(props);
  return (
    <>
      <button onClick={() => api.pick('avatar')}>換頭像</button>
      <button onClick={() => api.pick('cover')}>換封面</button>
      <output data-testid="busy">{api.busyKind ?? '閒置'}</output>
      {api.overlay}
    </>
  );
}

function setup(target: TeamDoc | null = team) {
  const onSaved = vi.fn<(kind: TeamImageKind) => void | Promise<void>>();
  const view = render(<Harness team={target} viewer={viewer} onSaved={onSaved} />);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('找不到上傳 input');
  const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
  return { ...view, input, click, onSaved };
}

type Fixture = ReturnType<typeof setup>;

function selectFile(fixture: Fixture, kind: TeamImageKind, file?: File) {
  fireEvent.click(screen.getByText(kind === 'avatar' ? '換頭像' : '換封面'));
  Object.defineProperty(fixture.input, 'files', {
    configurable: true,
    value: file ? [file] : [],
  });
  // 原生 change 避免 preact/compat 對 fireEvent.change 的事件轉換。
  act(() => {
    fixture.input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function openCropper(fixture: Fixture, kind: TeamImageKind) {
  selectFile(fixture, kind, new File(['image'], 'photo.png', { type: 'image/png' }));
  await screen.findByTestId('cropper');
}

async function confirmAll(kind: TeamImageKind) {
  fireEvent.click(screen.getByText('確認'));
  if (kind === 'cover') {
    await screen.findByText('俱樂部卡片 2/2');
    fireEvent.click(screen.getByText('確認'));
  }
}

async function expectIdle() {
  await waitFor(() => {
    expect(screen.getByTestId('busy').textContent).toBe('閒置');
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  cropperLog.options.length = 0;
  cropperLog.props.length = 0;
  vi.mocked(canEditTeamSettings).mockReset().mockReturnValue(true);
  vi.mocked(uploadImageDataUrl).mockReset().mockResolvedValue(AVATAR_URL);
  vi.mocked(saveTeamAvatar).mockReset().mockResolvedValue(undefined);
  vi.mocked(saveTeamCover).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('俱樂部圖片上傳', () => {
  it('team 為 null 時忽略頭像選檔且不提示 toast', () => {
    const fixture = setup(null);

    fireEvent.click(screen.getByText('換頭像'));

    expect(fixture.click).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(canEditTeamSettings).not.toHaveBeenCalled();
    expect(uploadImageDataUrl).not.toHaveBeenCalled();
    expect(fixture.onSaved).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cropper')).toBeNull();
    expect(screen.getByTestId('busy').textContent).toBe('閒置');
  });
  it('無權限時使用共用權限判斷並阻止選檔', () => {
    vi.mocked(canEditTeamSettings).mockReturnValue(false);
    const fixture = setup();

    fireEvent.click(screen.getByText('換頭像'));

    expect(canEditTeamSettings).toHaveBeenCalledWith(viewer, team);
    expect(toast.show).toHaveBeenCalledWith({
      message: '您沒有編輯此俱樂部的權限',
      tone: 'error',
    });
    expect(fixture.click).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cropper')).toBeNull();
  });

  it('隱藏 input 使用圖片類型並在沒有檔案時結束', () => {
    const fixture = setup();
    expect(fixture.input.hidden).toBe(true);
    expect(fixture.input.style.display).toBe('none');
    expect(fixture.input.accept).toBe('image/*');

    selectFile(fixture, 'avatar');

    expect(fixture.input.value).toBe('');
    expect(screen.queryByTestId('cropper')).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('拒絕非圖片檔案', () => {
    const fixture = setup();
    selectFile(fixture, 'avatar', new File(['text'], 'note.txt', { type: 'text/plain' }));

    expect(toast.show).toHaveBeenCalledWith({
      message: '請上傳 JPG / PNG / WebP 圖片',
      tone: 'error',
    });
    expect(screen.queryByTestId('cropper')).toBeNull();
    expect(uploadImageDataUrl).not.toHaveBeenCalled();
  });

  it('拒絕超過五 MB 一位元組的圖片', () => {
    const fixture = setup();
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
      type: 'image/png',
    });
    selectFile(fixture, 'cover', file);

    expect(toast.show).toHaveBeenCalledWith({
      message: '圖片太大，不能超過 5MB',
      tone: 'error',
    });
    expect(screen.queryByTestId('cropper')).toBeNull();
  });

  it('接受 MIME 空白但副檔名為 heic 的圖片', async () => {
    const fixture = setup();
    selectFile(fixture, 'avatar', new File(['image'], 'photo.heic', { type: '' }));

    await screen.findByTestId('cropper');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('頭像裁切逐欄符合規格並依上傳寫入重讀順序完成', async () => {
    const fixture = setup();
    const order: string[] = [];
    vi.mocked(uploadImageDataUrl).mockImplementation(async () => {
      order.push('上傳');
      return AVATAR_URL;
    });
    vi.mocked(saveTeamAvatar).mockImplementation(async () => {
      order.push('寫入');
    });
    fixture.onSaved.mockImplementation(() => {
      order.push('重讀');
    });

    await openCropper(fixture, 'avatar');
    expect(cropperLog.options.at(-1)).toEqual({
      aspectRatio: 1,
      outputWidth: 900,
      outputHeight: 900,
      outputType: 'image/webp',
      quality: 0.9,
      title: '俱樂部頭像',
      subtitle: '請將圖片放在方形範圍內，完成後會直接作為俱樂部頭像。',
      targetLabel: '俱樂部頭像',
      recommendedSize: '900 x 900',
      aspectLabel: '1:1',
      maxZoom: 5,
      cancelText: '取消',
    });

    await confirmAll('avatar');
    await waitFor(() => expect(fixture.onSaved).toHaveBeenCalledWith('avatar'));
    await expectIdle();

    expect(uploadImageDataUrl).toHaveBeenCalledExactlyOnceWith(
      DATA_URL, 'teams/tm_test_1_avatar',
    );
    expect(saveTeamAvatar).toHaveBeenCalledExactlyOnceWith(team, AVATAR_URL);
    expect(saveTeamCover).not.toHaveBeenCalled();
    expect(order).toEqual(['上傳', '寫入', '重讀']);
    expect(toast.show).toHaveBeenCalledWith({
      message: '俱樂部頭像已更新',
      tone: 'success',
    });
  });

  it('封面依序裁切與上傳兩張圖片並寫入正確欄位', async () => {
    const fixture = setup();
    const firstUpload = deferred<string | null>();
    vi.mocked(uploadImageDataUrl)
      .mockReturnValueOnce(firstUpload.promise)
      .mockResolvedValueOnce(CARD_URL);

    await openCropper(fixture, 'cover');
    const common = {
      outputType: 'image/webp',
      quality: 0.9,
      maxZoom: 5,
      cancelText: '取消',
    };
    expect(cropperLog.options.at(-1)).toEqual({
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
    });

    fireEvent.click(screen.getByText('確認'));
    await screen.findByText('俱樂部卡片 2/2');
    expect(cropperLog.options.at(-1)).toEqual({
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
    });
    expect(uploadImageDataUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('確認'));
    expect(uploadImageDataUrl).toHaveBeenCalledTimes(1);
    expect(saveTeamCover).not.toHaveBeenCalled();

    await act(async () => {
      firstUpload.resolve(COVER_URL);
      await firstUpload.promise;
    });
    await waitFor(() => expect(fixture.onSaved).toHaveBeenCalledWith('cover'));
    await expectIdle();

    expect(uploadImageDataUrl).toHaveBeenNthCalledWith(
      1, DATA_URL, 'teams/tm_test_1_cover',
    );
    expect(uploadImageDataUrl).toHaveBeenNthCalledWith(
      2, DATA_URL, 'teams/tm_test_1_card',
    );
    expect(uploadImageDataUrl).toHaveBeenCalledTimes(2);
    expect(saveTeamCover).toHaveBeenCalledExactlyOnceWith(team, {
      image: COVER_URL,
      imageVariants: { cover: COVER_URL, card: CARD_URL },
    });
    expect(saveTeamAvatar).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({
      message: '俱樂部封面已更新',
      tone: 'success',
    });
  });

  it.each([
    ['頭像', 'avatar', false],
    ['封面第一張', 'cover', false],
    ['封面第二張', 'cover', true],
  ] as const)('%s 取消時結束整個流程且沒有副作用', async (_label, kind, second) => {
    const fixture = setup();
    await openCropper(fixture, kind);
    if (second) {
      fireEvent.click(screen.getByText('確認'));
      await screen.findByText('俱樂部卡片 2/2');
    }

    fireEvent.click(screen.getByText('取消'));

    expect(screen.queryByTestId('cropper')).toBeNull();
    expect(uploadImageDataUrl).not.toHaveBeenCalled();
    expect(saveTeamAvatar).not.toHaveBeenCalled();
    expect(saveTeamCover).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(fixture.onSaved).not.toHaveBeenCalled();
    await expectIdle();
  });

  it.each([
    ['頭像', 'avatar', '頭像上傳失敗，請稍後再試'],
    ['封面', 'cover', '封面上傳失敗，請稍後再試'],
  ] as const)('%s 上傳回傳 null 時提示失敗並可重新選檔', async (_label, kind, message) => {
    const fixture = setup();
    vi.mocked(uploadImageDataUrl).mockResolvedValue(null);
    await openCropper(fixture, kind);
    await confirmAll(kind);

    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message,
      tone: 'error',
    }));
    await expectIdle();
    expect(saveTeamAvatar).not.toHaveBeenCalled();
    expect(saveTeamCover).not.toHaveBeenCalled();
    expect(fixture.onSaved).not.toHaveBeenCalled();

    await openCropper(fixture, kind);
    expect(fixture.click).toHaveBeenCalledTimes(2);
  });

  it('第二張封面上傳失敗時不寫入不完整的 variants', async () => {
    const fixture = setup();
    vi.mocked(uploadImageDataUrl)
      .mockResolvedValueOnce(COVER_URL)
      .mockResolvedValueOnce(null);

    await openCropper(fixture, 'cover');
    await confirmAll('cover');
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message: '封面上傳失敗，請稍後再試',
      tone: 'error',
    }));
    await expectIdle();
    expect(saveTeamCover).not.toHaveBeenCalled();
    expect(fixture.onSaved).not.toHaveBeenCalled();
  });

  it.each([
    ['頭像', 'avatar', '頭像上傳失敗，請稍後再試'],
    ['封面', 'cover', '封面上傳失敗，請稍後再試'],
  ] as const)('%s 寫入拒絕時不呼叫重讀並清除忙碌狀態', async (_label, kind, message) => {
    const fixture = setup();
    const error = new Error('寫入失敗');
    if (kind === 'avatar') vi.mocked(saveTeamAvatar).mockRejectedValue(error);
    else vi.mocked(saveTeamCover).mockRejectedValue(error);

    await openCropper(fixture, kind);
    await confirmAll(kind);
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message,
      tone: 'error',
    }));
    await expectIdle();

    expect(console.error).toHaveBeenCalledWith('[useTeamImageUpload]', error);
    expect(fixture.onSaved).not.toHaveBeenCalled();
  });

  it('重讀拒絕時保留成功提示且自行處理拒絕', async () => {
    const fixture = setup();
    const error = new Error('重讀失敗');
    fixture.onSaved.mockRejectedValue(error);

    await openCropper(fixture, 'avatar');
    await confirmAll('avatar');
    await waitFor(() => expect(console.error).toHaveBeenCalledWith(
      '[useTeamImageUpload]', error,
    ));
    await expectIdle();

    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      message: '俱樂部頭像已更新',
      tone: 'success',
    });
  });

  it('上傳與等待重讀期間忽略再次選檔並隱藏裁切器', async () => {
    const fixture = setup();
    const pendingUpload = deferred<string | null>();
    const pendingSaved = deferred<void>();
    vi.mocked(uploadImageDataUrl).mockReturnValue(pendingUpload.promise);
    fixture.onSaved.mockReturnValue(pendingSaved.promise);

    await openCropper(fixture, 'avatar');
    await confirmAll('avatar');
    expect(screen.getByTestId('busy').textContent).toBe('avatar');
    expect(screen.queryByTestId('cropper')).toBeNull();

    fireEvent.click(screen.getByText('換封面'));
    expect(fixture.click).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingUpload.resolve(AVATAR_URL);
      await pendingUpload.promise;
    });
    await waitFor(() => expect(fixture.onSaved).toHaveBeenCalledWith('avatar'));
    expect(screen.getByTestId('busy').textContent).toBe('avatar');
    fireEvent.click(screen.getByText('換頭像'));
    expect(fixture.click).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingSaved.resolve(undefined);
      await pendingSaved.promise;
    });
    await expectIdle();
  });

  it('卸載後上傳完成不更新狀態且沒有警告或未處理拒絕', async () => {
    const fixture = setup();
    const pending = deferred<string | null>();
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    vi.mocked(uploadImageDataUrl).mockReturnValue(pending.promise);

    try {
      await openCropper(fixture, 'avatar');
      await confirmAll('avatar');
      fixture.unmount();

      await act(async () => {
        pending.resolve(AVATAR_URL);
        await pending.promise;
      });

      expect(console.error).not.toHaveBeenCalled();
      expect(warnings).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
      expect(saveTeamAvatar).not.toHaveBeenCalled();
      expect(fixture.onSaved).not.toHaveBeenCalled();
      expect(toast.show).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('unhandledrejection', unhandled);
    }
  });

  it('新選檔使舊裁切確認與取消回呼失效', async () => {
    const fixture = setup();
    await openCropper(fixture, 'cover');
    const oldProps = cropperLog.props.at(-1);
    if (!oldProps) throw new Error('缺少舊裁切回呼');

    await openCropper(fixture, 'avatar');
    act(() => {
      oldProps.onConfirm(DATA_URL);
      oldProps.onCancel();
    });

    expect(screen.getByText('俱樂部頭像')).toBeTruthy();
    expect(uploadImageDataUrl).not.toHaveBeenCalled();
    await confirmAll('avatar');
    await waitFor(() => expect(fixture.onSaved).toHaveBeenCalledWith('avatar'));
    expect(uploadImageDataUrl).toHaveBeenCalledExactlyOnceWith(
      DATA_URL, 'teams/tm_test_1_avatar',
    );
  });

  it('同步重複確認只啟動一次上傳', async () => {
    const fixture = setup();
    await openCropper(fixture, 'avatar');
    const props = cropperLog.props.at(-1);
    if (!props) throw new Error('缺少裁切回呼');

    act(() => {
      props.onConfirm(DATA_URL);
      props.onConfirm(DATA_URL);
    });

    await waitFor(() => expect(fixture.onSaved).toHaveBeenCalledTimes(1));
    expect(uploadImageDataUrl).toHaveBeenCalledTimes(1);
    expect(saveTeamAvatar).toHaveBeenCalledTimes(1);
  });

  it('讀檔拋錯時提示處理失敗且可重新選檔', async () => {
    const fixture = setup();
    const readerSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL')
      .mockImplementationOnce(() => {
        throw new Error('讀檔失敗');
      });

    selectFile(fixture, 'avatar', new File(['image'], 'photo.png'));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message: '圖片處理失敗，請重試',
      tone: 'error',
    }));
    expect(uploadImageDataUrl).not.toHaveBeenCalled();

    readerSpy.mockRestore();
    await openCropper(fixture, 'avatar');
    expect(screen.getByTestId('cropper')).toBeTruthy();
  });

  it('卸載時中止尚未完成的 FileReader 且不提示錯誤', async () => {
    const fixture = setup();
    const abort = vi.spyOn(FileReader.prototype, 'abort');
    selectFile(fixture, 'avatar', new File(['image'], 'photo.png'));
    fixture.unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(abort).toHaveBeenCalledTimes(1);
    expect(toast.show).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('沒有業務 id 時使用文件 id 組成上傳路徑', async () => {
    const target: TeamDoc = { _docId: 'tm_test_1' };
    const fixture = setup(target);
    await openCropper(fixture, 'avatar');
    await confirmAll('avatar');

    await waitFor(() => expect(saveTeamAvatar).toHaveBeenCalledWith(target, AVATAR_URL));
    expect(uploadImageDataUrl).toHaveBeenCalledWith(DATA_URL, 'teams/tm_test_1_avatar');
  });

  it('空白 id 不退回文件 id 且依失敗流程處理', async () => {
    const fixture = setup({ id: '', _docId: 'tm_test_1' });
    await openCropper(fixture, 'avatar');
    await confirmAll('avatar');

    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message: '頭像上傳失敗，請稍後再試',
      tone: 'error',
    }));
    await expectIdle();
    expect(uploadImageDataUrl).not.toHaveBeenCalled();
    expect(saveTeamAvatar).not.toHaveBeenCalled();
    expect(fixture.onSaved).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ImageCropperProps } from './ImageCropper';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  cropper: vi.fn(),
}));

vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.toast } }));
vi.mock('./ImageCropper', () => ({
  ImageCropper: (props: ImageCropperProps) => {
    mocks.cropper(props);
    return (
      <div role="dialog" data-source={props.src}>
        <h2>{props.options.title}</h2>
        <div>{props.options.subtitle}</div>
        <button type="button" onClick={() => props.onConfirm(
          props.options.aspectLabel === '8:3'
            ? 'data:image/webp;base64,COVER'
            : 'data:image/webp;base64,NEXT',
        )}>{props.options.confirmText}</button>
        <button type="button" onClick={props.onCancel}>{props.options.cancelText}</button>
      </div>
    );
  },
}));

import { useCoverUpload } from './use-cover-upload';

class ControlledFileReader {
  static instances: ControlledFileReader[] = [];
  readyState = 0;
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  file: File | null = null;

  constructor() {
    ControlledFileReader.instances.push(this);
  }

  readAsDataURL(file: File) {
    this.file = file;
    this.readyState = 1;
  }

  abort() {
    this.readyState = 2;
    this.onabort?.();
  }

  succeed(value: string) {
    this.result = value;
    this.readyState = 2;
    this.onload?.();
  }

  fail() {
    this.readyState = 2;
    this.onerror?.();
  }
}

let current: ReturnType<typeof useCoverUpload> | null = null;

function Harness() {
  const upload = useCoverUpload();
  current = upload;
  return (
    <div>
      <input id="ce-image" type="file" />
      <output data-testid="preview">{upload.view.previewUrl}</output>
      <output data-testid="value">{JSON.stringify(upload.value)}</output>
      {upload.cropper}
    </div>
  );
}

function getCurrent() {
  if (!current) throw new Error('Hook not mounted');
  return current;
}

function pick(file = new File(['image'], 'cover.png', { type: 'image/png' })) {
  act(() => { getCurrent().view.onPickFile(file); });
}

async function finishRead(value = 'data:image/png;base64,SOURCE') {
  const reader = ControlledFileReader.instances.at(-1);
  if (!reader) throw new Error('Reader missing');
  await act(async () => {
    reader.succeed(value);
    await Promise.resolve();
  });
  await screen.findByRole('button', { name: '下一步' });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.lang = 'zh-TW';
  ControlledFileReader.instances = [];
  vi.stubGlobal('FileReader', ControlledFileReader);
  current = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  current = null;
});

describe('useCoverUpload', () => {
  it('初始為空；未選檔時不渲染裁圖', () => {
    render(<Harness />);
    expect(getCurrent().value).toEqual({ image: '' });
    expect(getCurrent().cropper).toBeNull();
    expect(mocks.cropper).not.toHaveBeenCalled();
  });

  it('拒絕不允許的 MIME 與副檔名，顯示 A 原文', () => {
    render(<Harness />);
    pick(new File(['text'], 'notes.txt', { type: 'text/plain' }));
    expect(mocks.toast).toHaveBeenCalledWith({
      message: '請上傳 JPG / PNG / WebP 圖片',
      tone: 'error',
    });
    expect(ControlledFileReader.instances).toHaveLength(0);
    expect(getCurrent().cropper).toBeNull();
  });

  it('超過 5MB 拒絕，剛好 5MB 接受', () => {
    render(<Harness />);
    const large = new File(['image'], 'large.png', { type: 'image/png' });
    Object.defineProperty(large, 'size', { value: 5 * 1024 * 1024 + 1 });
    pick(large);
    expect(mocks.toast).toHaveBeenCalledWith({
      message: '圖片太大，不能超過 5MB',
      tone: 'error',
    });
    expect(ControlledFileReader.instances).toHaveLength(0);

    const exact = new File(['image'], 'exact.png', { type: 'image/png' });
    Object.defineProperty(exact, 'size', { value: 5 * 1024 * 1024 });
    pick(exact);
    expect(ControlledFileReader.instances).toHaveLength(1);
  });

  it('照 A 接受大小寫副檔名與 HEIC／HEIF', () => {
    render(<Harness />);
    for (const file of [
      new File(['image'], 'cover.JPG', { type: '' }),
      new File(['image'], 'cover.bin', { type: 'image/heic' }),
      new File(['image'], 'cover.HEIF', { type: 'application/octet-stream' }),
    ]) {
      pick(file);
    }
    expect(ControlledFileReader.instances).toHaveLength(3);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('依 A 順序裁兩張，全部完成後才提交 value 與預覽', async () => {
    render(<Harness />);
    pick();
    await finishRead();
    expect(screen.getByText('活動封面 1/2')).toBeTruthy();
    expect(screen.getByText('會用在活動詳細頁、活動卡片與分享預覽。')).toBeTruthy();
    const first = mocks.cropper.mock.lastCall?.[0] as ImageCropperProps;
    expect(first.options).toMatchObject({
      aspectRatio: 8 / 3,
      outputWidth: 1200,
      outputHeight: 450,
      recommendedSize: '800 x 300',
      aspectLabel: '8:3',
      outputType: 'image/webp',
      quality: 0.9,
      maxZoom: 5,
      confirmText: '下一步',
    });

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('首頁下一場活動 2/2')).toBeTruthy();
    expect(screen.getByText('會用在首頁「我的下一場活動」圖片區。')).toBeTruthy();
    expect(getCurrent().value).toEqual({ image: '' });
    const second = mocks.cropper.mock.lastCall?.[0] as ImageCropperProps;
    expect(second.src).toBe(first.src);
    expect(second.options).toMatchObject({
      aspectRatio: 4 / 3,
      outputWidth: 1000,
      outputHeight: 750,
      recommendedSize: '800 x 600',
      aspectLabel: '4:3',
      confirmText: '完成',
    });

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(getCurrent().value).toEqual({
      image: 'data:image/webp;base64,COVER',
      imageVariants: {
        cover: 'data:image/webp;base64,COVER',
        homeNext: 'data:image/webp;base64,NEXT',
      },
    });
    expect(getCurrent().view.previewUrl).toBe('data:image/webp;base64,COVER');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('第一或第二張取消都清掉 variants，保留先前預覽', async () => {
    render(<Harness />);
    pick();
    await finishRead();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(getCurrent().value.imageVariants).toBeDefined();

    pick();
    await finishRead();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(getCurrent().value).toEqual({ image: 'data:image/webp;base64,COVER' });

    pick();
    await finishRead();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(getCurrent().value).toEqual({ image: 'data:image/webp;base64,COVER' });
    expect(getCurrent().view.previewUrl).toBe('data:image/webp;base64,COVER');
  });

  it('編輯 reset 採 cover || image，送出值不保留既有 variants', () => {
    render(<Harness />);
    act(() => {
      getCurrent().reset({
        image: 'https://example.com/main',
        imageVariants: {
          cover: 'https://example.com/cover',
          homeNext: 'https://example.com/next',
        },
      });
    });
    expect(getCurrent().value).toEqual({ image: 'https://example.com/cover' });
    expect(getCurrent().view.previewUrl).toBe('https://example.com/cover');

    act(() => {
      getCurrent().reset({
        image: 'https://example.com/main',
        imageVariants: { homeNext: 'https://example.com/next' },
      });
    });
    expect(getCurrent().value).toEqual({ image: 'https://example.com/main' });

    act(() => { getCurrent().reset({ image: '' }); });
    expect(getCurrent().value).toEqual({ image: '' });
  });

  it('讀檔失敗顯示 A 提示，保留舊值並可重試', async () => {
    render(<Harness />);
    act(() => { getCurrent().reset({ image: 'https://example.com/old' }); });
    pick();
    await act(async () => {
      ControlledFileReader.instances[0]?.fail();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        message: '圖片處理失敗，請重試',
        tone: 'error',
      });
    });
    expect(getCurrent().value).toEqual({ image: 'https://example.com/old' });

    pick();
    await finishRead();
    expect(screen.getByText('活動封面 1/2')).toBeTruthy();
  });

  it('快速選 A 再選 B，晚到的 A 不覆蓋 B', async () => {
    render(<Harness />);
    pick(new File(['A'], 'a.png', { type: 'image/png' }));
    const readerA = ControlledFileReader.instances[0]!;
    const lateA = readerA.onload;
    expect(lateA).toBeTypeOf('function');
    pick(new File(['B'], 'b.png', { type: 'image/png' }));
    const readerB = ControlledFileReader.instances[1]!;
    expect(readerB).not.toBe(readerA);
    expect(readerB.file?.name).toBe('b.png');
    await finishRead('data:image/png;base64,B');
    expect(screen.getByRole('dialog').getAttribute('data-source'))
      .toBe('data:image/png;base64,B');

    await act(async () => {
      readerA.result = 'data:image/png;base64,A';
      lateA!();
      await vi.dynamicImportSettled();
    });
    expect(screen.getByRole('dialog').getAttribute('data-source'))
      .toBe('data:image/png;base64,B');
    expect(getCurrent().value).toEqual({ image: '' });
    expect(mocks.toast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('dialog').getAttribute('data-source'))
      .toBe('data:image/png;base64,B');
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(getCurrent().value).toEqual({
      image: 'data:image/webp;base64,COVER',
      imageVariants: {
        cover: 'data:image/webp;base64,COVER',
        homeNext: 'data:image/webp;base64,NEXT',
      },
    });
  });

  it('reset 使讀檔及舊裁圖回呼失效', async () => {
    render(<Harness />);
    pick();
    const reader = ControlledFileReader.instances[0]!;
    const lateLoad = reader.onload;
    expect(lateLoad).toBeTypeOf('function');
    act(() => { getCurrent().reset({ image: 'https://example.com/reset' }); });
    await act(async () => {
      reader.result = 'data:image/png;base64,LATE';
      lateLoad!();
      await vi.dynamicImportSettled();
    });
    expect(getCurrent().value).toEqual({ image: 'https://example.com/reset' });
    expect(getCurrent().cropper).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.toast).not.toHaveBeenCalled();

    pick();
    expect(ControlledFileReader.instances).toHaveLength(2);
    await finishRead();
    expect(screen.getByRole('dialog').getAttribute('data-source'))
      .toBe('data:image/png;base64,SOURCE');
    const cropper = getCurrent().cropper;
    expect(cropper).not.toBeNull();
    if (!cropper) throw new Error('New selection did not render a cropper');
    const staleCropper = cropper.props as ImageCropperProps;
    expect(staleCropper.onConfirm).toBeTypeOf('function');
    expect(staleCropper.onCancel).toBeTypeOf('function');

    act(() => { getCurrent().reset({ image: 'https://example.com/reset-again' }); });
    act(() => {
      staleCropper.onConfirm('data:image/webp;base64,STALE');
    });
    expect(getCurrent().value).toEqual({ image: 'https://example.com/reset-again' });
    expect(getCurrent().cropper).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      staleCropper.onCancel();
    });
    expect(getCurrent().value).toEqual({ image: 'https://example.com/reset-again' });
    expect(getCurrent().cropper).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('卸載中止讀檔；晚到結果不渲染、不提示', async () => {
    const rendered = render(<Harness />);
    pick();
    const reader = ControlledFileReader.instances[0]!;
    const lateLoad = reader.onload;
    rendered.unmount();
    await act(async () => {
      reader.result = 'data:image/png;base64,LATE';
      lateLoad?.();
      await Promise.resolve();
    });
    expect(reader.onload).toBeNull();
    expect(reader.onerror).toBeNull();
    expect(reader.onabort).toBeNull();
    expect(mocks.cropper).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

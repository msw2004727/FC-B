import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

const overlay = vi.hoisted(() => ({
  push: vi.fn(),
  release: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/core/overlay-back', () => ({ pushOverlay: overlay.push }));
vi.mock('@/ui/Toast', () => ({ toast: { show: overlay.toast } }));

import { ImageCropper, type ImageCropperOptions } from './ImageCropper';

class TestImage {
  static instances: TestImage[] = [];
  static automatic = true;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1600;
  naturalHeight = 900;
  width = 1600;
  height = 900;
  private url = '';

  constructor() {
    TestImage.instances.push(this);
  }

  get src() { return this.url; }

  set src(value: string) {
    this.url = value;
    if (TestImage.automatic) {
      queueMicrotask(() => this.onload?.());
    }
  }
}

const context = {
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  imageSmoothingEnabled: false,
  imageSmoothingQuality: 'low',
  fillStyle: '',
};

const options: ImageCropperOptions = {
  aspectRatio: 8 / 3,
  outputWidth: 1200,
  outputHeight: 450,
  outputType: 'image/webp',
  quality: 0.9,
  title: '活動封面 1/2',
  subtitle: '會用在活動詳細頁、活動卡片與分享預覽。',
  targetLabel: '活動封面',
  recommendedSize: '800 x 300',
  aspectLabel: '8:3',
  confirmText: '下一步',
  cancelText: '取消',
};

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.lang = 'zh-TW';
  TestImage.instances = [];
  TestImage.automatic = true;
  vi.stubGlobal('Image', TestImage);
  overlay.push.mockReturnValue(overlay.release);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValue('data:image/webp;base64,RESULT');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function ready() {
  await waitFor(() => {
    expect(document.querySelector('.image-cropper-image')).not.toBeNull();
  });
}

describe('ImageCropper', () => {
  it('portal 包覆 legacy-ui，照 A 渲染標題、按鈕與框線說明', async () => {
    const { container } = render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(container.querySelector('.image-cropper-overlay')).toBeNull();
    expect(document.body.querySelector('.legacy-ui.image-cropper-open .image-cropper-overlay'))
      .not.toBeNull();
    expect(screen.getByText('活動封面 1/2')).toBeTruthy();
    expect(screen.getByText('會用在活動詳細頁、活動卡片與分享預覽。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一步' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '旋轉' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重設' })).toBeTruthy();
    await ready();
    expect(screen.getByText('活動封面 / 建議 800 x 300 / 8:3')).toBeTruthy();
  });

  it('取消與關閉鈕會呼叫 onCancel 並釋放 overlay', () => {
    const onCancel = vi.fn();
    const first = render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={onCancel} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(overlay.release).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();

    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={onCancel} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('返回鍵透過 pushOverlay 取消', () => {
    const onCancel = vi.fn();
    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={onCancel} onConfirm={vi.fn()} />,
    );
    const back = overlay.push.mock.calls[0]?.[0] as () => boolean;
    act(() => { expect(back()).toBe(true); });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('確認依指定尺寸、格式與品質輸出，呼叫 onConfirm', async () => {
    const sizes: number[][] = [];
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      sizes.push([this.width, this.height]);
      return 'data:image/webp;base64,RESULT';
    });
    const onConfirm = vi.fn();
    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={vi.fn()} onConfirm={onConfirm} />,
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(context.drawImage).toHaveBeenCalled();
    expect(sizes).toEqual([[1200, 450]]);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/webp', 0.9);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('data:image/webp;base64,RESULT');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('WebP 不受支援時退回 JPEG', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL)
      .mockReturnValueOnce('data:image/png;base64,PNG')
      .mockReturnValueOnce('data:image/jpeg;base64,JPEG');
    const onConfirm = vi.fn();
    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={vi.fn()} onConfirm={onConfirm} />,
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.9);
    expect(onConfirm).toHaveBeenCalledWith('data:image/jpeg;base64,JPEG');
  });

  it('JPEG 輸出先填白底；尺寸與品質遵守 A 邊界', async () => {
    const sizes: number[][] = [];
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      sizes.push([this.width, this.height]);
      return 'data:image/jpeg;base64,JPEG';
    });
    render(
      <ImageCropper src="data:image/png;base64,SOURCE"
        options={{ ...options, outputType: 'image/jpeg', outputWidth: 10, outputHeight: 9000, quality: 0.1 }}
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(sizes).toEqual([[320, 2400]]);
    expect(context.fillStyle).toBe('#fff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 320, 2400);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.5);
  });

  it('縮放按鈕、滑桿、滾輪與重設會更新比例', async () => {
    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('112%')).toBeTruthy();
    fireEvent.input(screen.getByRole('slider'), { target: { value: '200' } });
    expect(screen.getByText('200%')).toBeTruthy();

    const viewport = document.querySelector('.image-cropper-viewport')!;
    fireEvent.wheel(viewport, { deltaY: -1, clientX: 100, clientY: 100 });
    expect(screen.getByText('216%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重設' }));
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('拖曳與雙指縮放可連續操作', async () => {
    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    await ready();
    fireEvent.input(screen.getByRole('slider'), { target: { value: '200' } });
    const viewport = document.querySelector('.image-cropper-viewport')!;
    const image = document.querySelector('.image-cropper-image') as HTMLImageElement;
    const initial = image.style.transform;

    const pointer = (type: string, id: number, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerId: { value: id },
        clientX: { value: x },
        clientY: { value: y },
      });
      act(() => { viewport.dispatchEvent(event); });
    };

    pointer('pointerdown', 1, 100, 100);
    pointer('pointermove', 1, 120, 120);
    expect(image.style.transform).not.toBe(initial);
    pointer('pointerdown', 2, 220, 120);
    pointer('pointermove', 2, 320, 120);
    expect(screen.getByText('400%')).toBeTruthy();
    pointer('pointerup', 2, 320, 120);
    const afterPinch = image.style.transform;
    pointer('pointermove', 1, 140, 140);
    expect(image.style.transform).not.toBe(afterPinch);
    pointer('pointerup', 1, 140, 140);
  });

  it('旋轉透過 canvas 重新載入並回到 100%', async () => {
    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: '旋轉' }));
    await ready();
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(context.translate).toHaveBeenCalledWith(450, 800);
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('canvas 失敗顯示 A 提示，仍可重試', async () => {
    const onConfirm = vi.fn();
    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={vi.fn()} onConfirm={onConfirm} />,
    );
    await ready();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(overlay.toast).toHaveBeenCalledWith({
      message: '圖片處理失敗，請重試',
      tone: 'error',
    });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('圖片讀取失敗顯示提示並取消', () => {
    TestImage.automatic = false;
    const onCancel = vi.fn();
    render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={onCancel} onConfirm={vi.fn()} />,
    );
    act(() => { TestImage.instances[0]?.onerror?.(); });
    expect(overlay.toast).toHaveBeenCalledWith({
      message: '圖片讀取失敗，請換一張圖片',
      tone: 'error',
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('卸載後忽略圖片晚到回呼，並清除 wheel listener', async () => {
    TestImage.automatic = false;
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const first = render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={onCancel} onConfirm={onConfirm} />,
    );
    const image = TestImage.instances[0]!;
    const lateLoad = image.onload;
    first.unmount();
    act(() => { lateLoad?.(); });
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    TestImage.automatic = true;
    const second = render(
      <ImageCropper src="data:image/png;base64,SOURCE" options={options}
        onCancel={onCancel} onConfirm={onConfirm} />,
    );
    await ready();
    const viewport = document.querySelector('.image-cropper-viewport')!;
    const remove = vi.spyOn(viewport, 'removeEventListener');
    second.unmount();
    expect(remove).toHaveBeenCalledWith('wheel', expect.any(Function));
  });

  it('標題作為 JSX 文字，不解析使用者 HTML', () => {
    render(
      <ImageCropper src="data:image/png;base64,SOURCE"
        options={{ title: '<img src=x onerror=alert(1)>' }}
        onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('.image-cropper-title img')).toBeNull();
  });
});

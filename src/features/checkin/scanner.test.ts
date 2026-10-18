import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ponyfill = vi.hoisted(() => ({
  loaded: vi.fn(),
  prepare: vi.fn(),
  detect: vi.fn(async () => [] as { rawValue: string }[]),
}));

vi.mock('barcode-detector/ponyfill', () => {
  ponyfill.loaded();
  return {
    prepareZXingModule: ponyfill.prepare,
    BarcodeDetector: class {
      detect = ponyfill.detect;
    },
  };
});

vi.mock('zxing-wasm/reader/zxing_reader.wasm?url', () => ({
  default: '/assets/zxing_reader.wasm',
}));

describe('QR scanner', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('BarcodeDetector', undefined);
    delete (window as unknown as Record<string, unknown>).BarcodeDetector;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses native QR support without importing the ponyfill', async () => {
    const nativeDetect = vi.fn(async () => []);
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['qr_code'];
      detect = nativeDetect;
    });

    const { createQrDetector } = await import('./scanner');
    const detector = await createQrDetector();
    await detector.detect(document.createElement('video'));

    expect(nativeDetect).toHaveBeenCalledOnce();
    expect(ponyfill.loaded).not.toHaveBeenCalled();
    expect(ponyfill.prepare).not.toHaveBeenCalled();
  });

  it('dynamically imports the ponyfill when BarcodeDetector is absent', async () => {
    const { createQrDetector } = await import('./scanner');
    await createQrDetector();

    expect(ponyfill.loaded).toHaveBeenCalledOnce();
    const options = ponyfill.prepare.mock.calls[0]?.[0] as {
      overrides: { locateFile(path: string, prefix?: string): string };
    } | undefined;
    expect(options).toBeDefined();

    const url = options?.overrides.locateFile(
      'zxing_reader.wasm',
      'https://cdn.example.test/',
    );
    expect(url).toBe(`${window.location.origin}/assets/zxing_reader.wasm`);
  });

  it('falls back when native detection does not support QR codes', async () => {
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['ean_13'];
    });

    const { createQrDetector } = await import('./scanner');
    await createQrDetector();
    // mock factory 只在第一次 import 執行，改以每次載入都會呼叫的 prepare 判斷走了 ponyfill。
    expect(ponyfill.prepare).toHaveBeenCalledOnce();
  });

  it('rejects repeated QR values for two seconds, including A/B/A', async () => {
    const { createQrDeduplicator } = await import('./scanner');
    let time = 0;
    const accept = createQrDeduplicator(() => time);

    expect(accept('A')).toBe(true);
    expect(accept('B')).toBe(true);
    time = 1_999;
    expect(accept('A')).toBe(false);
    time = 2_000;
    expect(accept('A')).toBe(true);
  });

  it('releases tracks and clears video on stop', async () => {
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['qr_code'];
      detect = async () => [];
    });
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    const { createQrScanner } = await import('./scanner');
    const scanner = createQrScanner({ video, onScan: vi.fn(), onError: vi.fn() });

    await scanner.start();
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
    });
    scanner.stop();

    expect(stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('releases a stream that resolves after stop', async () => {
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['qr_code'];
      detect = async () => [];
    });
    let resolve: ((stream: MediaStream) => void) | undefined;
    const pending = new Promise<MediaStream>((done) => { resolve = done; });
    const getUserMedia = vi.fn(() => pending);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    const { createQrScanner } = await import('./scanner');
    const scanner = createQrScanner({
      video: document.createElement('video'),
      onScan: vi.fn(),
      onError: vi.fn(),
    });
    const starting = scanner.start();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    scanner.stop();

    const stop = vi.fn();
    resolve?.({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await starting;
    expect(stop).toHaveBeenCalledOnce();
  });

  it('reports denied camera access', async () => {
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => ['qr_code'];
      detect = async () => [];
    });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(
          new DOMException('Denied', 'NotAllowedError'),
        ),
      },
    });

    const { createQrScanner } = await import('./scanner');
    const scanner = createQrScanner({
      video: document.createElement('video'),
      onScan: vi.fn(),
      onError: vi.fn(),
    });
    await expect(scanner.start()).rejects.toMatchObject({ code: 'denied' });
  });
});

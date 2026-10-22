import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

interface Detector {
  detect(video: HTMLVideoElement): Promise<readonly { rawValue: string }[]>;
}

interface NativeDetectorConstructor {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

export type ScannerFailure = 'denied' | 'unsupported' | 'failed';

export class ScannerError extends Error {
  constructor(public readonly code: ScannerFailure) {
    super(code);
    this.name = 'ScannerError';
  }
}

export function scannerFailure(error: unknown): ScannerFailure {
  if (error instanceof ScannerError) return error.code;
  if (
    error instanceof DOMException
    && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  ) {
    return 'denied';
  }
  return 'failed';
}

export function createQrDeduplicator(
  now: () => number = () => performance.now(),
  windowMs = 3000,
): (value: string) => boolean {
  let lastValue: string | undefined;
  let lastTime = 0;

  return (value) => {
    const time = now();
    // 照 A `_toggleCamera`：只比較上一個接受碼；拒絕不延長時間。
    if (value === lastValue && time - lastTime < windowMs) return false;
    lastValue = value;
    lastTime = time;
    return true;
  };
}

export async function createQrDetector(): Promise<Detector> {
  if ('BarcodeDetector' in window) {
    const Native = (
      window as unknown as { BarcodeDetector?: NativeDetectorConstructor }
    ).BarcodeDetector;

    if (Native) {
      try {
        if ((await Native.getSupportedFormats()).includes('qr_code')) {
          return new Native({ formats: ['qr_code'] });
        }
      } catch {
        // 原生實作不可用時使用本站 WASM。
      }
    }
  }

  const localWasm = new URL(wasmUrl, window.location.href);
  if (localWasm.origin !== window.location.origin) {
    throw new ScannerError('unsupported');
  }

  const { BarcodeDetector, prepareZXingModule } =
    await import('barcode-detector/ponyfill');

  prepareZXingModule({
    overrides: {
      locateFile: (path: string) => (
        path.endsWith('.wasm')
          ? localWasm.href
          : new URL(path, localWasm).href
      ),
    },
  });

  return new BarcodeDetector({ formats: ['qr_code'] });
}

export interface QrScanner {
  start(): Promise<void>;
  stop(): void;
}

export interface QrScannerOptions {
  video: HTMLVideoElement;
  onScan: (uid: string) => Promise<void> | void;
  onError: (failure: ScannerFailure) => void;
}

export function createQrScanner(options: QrScannerOptions): QrScanner {
  let generation = 0;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const accept = createQrDeduplicator();

  const stop = (): void => {
    generation += 1;
    running = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    options.video.srcObject = null;
  };

  const start = async (): Promise<void> => {
    stop();
    const current = generation;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new ScannerError('unsupported');
    }

    try {
      const detector = await createQrDetector();
      if (generation !== current) return;

      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      if (generation !== current) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }

      stream = acquired;
      options.video.srcObject = acquired;
      options.video.muted = true;
      options.video.playsInline = true;
      await options.video.play();
      if (generation !== current) return;
      running = true;

      const tick = async (): Promise<void> => {
        if (!running || generation !== current) return;

        try {
          if (options.video.readyState >= 2) {
            const results = await detector.detect(options.video);
            if (!running || generation !== current) return;

            for (const result of results) {
              const uid = result.rawValue.trim();
              if (!uid || !accept(uid)) continue;
              await options.onScan(uid);
              break;
            }
          }
        } catch (error: unknown) {
          if (generation !== current) return;
          stop();
          options.onError(scannerFailure(error));
          return;
        }

        if (running && generation === current) {
          timer = setTimeout(() => {
            tick().catch(() => {
              if (generation !== current) return;
              stop();
              options.onError('failed');
            });
          }, 150);
        }
      };

      timer = setTimeout(() => {
        tick().catch(() => {
          if (generation !== current) return;
          stop();
          options.onError('failed');
        });
      }, 0);
    } catch (error: unknown) {
      if (generation !== current) return;
      stop();
      throw new ScannerError(scannerFailure(error));
    }
  };

  return { start, stop };
}

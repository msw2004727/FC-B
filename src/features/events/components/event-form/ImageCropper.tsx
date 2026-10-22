import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { pushOverlay } from '@/core/overlay-back';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import '@/styles/legacy/image-cropper.css';

export interface ImageCropperOptions {
  aspectRatio?: number | null;
  outputWidth?: number;
  outputHeight?: number | null;
  outputType?: string;
  quality?: number;
  minZoom?: number;
  maxZoom?: number;
  title?: string;
  subtitle?: string;
  targetLabel?: string;
  recommendedSize?: string;
  aspectLabel?: string;
  frameHint?: string;
  confirmText?: string;
  cancelText?: string;
  resetText?: string;
  rotateLabel?: string;
}

export interface ImageCropperProps {
  src: string;
  options: ImageCropperOptions;
  onConfirm(dataUrl: string): void;
  onCancel(): void;
}

interface EditorView {
  src: string;
  vpW: number;
  vpH: number;
  imgW: number;
  imgH: number;
  scale: number;
  tx: number;
  ty: number;
}

interface Point {
  x: number;
  y: number;
}

interface Actions {
  cancel(): void;
  confirm(): void;
  reset(): void;
  rotate(): void;
  scale(value: number): void;
  zoom(delta: number): void;
  down(event: PointerEvent): void;
  move(event: PointerEvent): void;
  end(event: PointerEvent): void;
  wheel(event: WheelEvent): void;
}

/** 照 A showImageCropper；由使用端動態載入。 */
export function ImageCropper({
  src,
  options,
  onConfirm,
  onCancel,
}: ImageCropperProps) {
  const lt = useLegacyT();
  const viewport = useRef<HTMLDivElement>(null);
  const actions = useRef<Actions | null>(null);
  const callbacks = useRef({ onConfirm, onCancel });
  callbacks.current = { onConfirm, onCancel };
  const [editor, setEditor] = useState<EditorView | null>(null);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);

  // 照 A _normalizeImageCropperOptions。
  const aspectRatio = Number(options.aspectRatio) > 0 ? Number(options.aspectRatio) : null;
  const outputWidth = Math.max(320, Math.min(2400, Math.trunc(options.outputWidth ?? 0) || 1200));
  const rawHeight = Math.trunc(options.outputHeight ?? 0);
  const outputHeight = rawHeight > 0 ? Math.max(240, Math.min(2400, rawHeight)) : null;
  const outputType = options.outputType || 'image/webp';
  const quality = Number.isFinite(Number(options.quality))
    ? Math.max(0.5, Math.min(1, Number(options.quality)))
    : 0.9;
  const minZoom = Math.max(0.1, Math.min(1, Number(options.minZoom) || 0.25));
  const maxZoom = Math.max(2, Math.min(8, Number(options.maxZoom) || 5));
  const title = options.title || '圖片編輯';
  const subtitle = options.subtitle || '拖曳調整位置，使用滑桿或滾輪放大縮小';
  const confirmText = options.confirmText || '確認';
  const cancelText = options.cancelText || '取消';
  const resetText = options.resetText || '重設';
  const rotateLabel = options.rotateLabel || '旋轉';
  const frameHint = options.frameHint?.trim() || [
    options.targetLabel ? lt(options.targetLabel, options.targetLabel).trim() : '',
    options.recommendedSize
      ? `${lt('建議 ', '建議 ')}${options.recommendedSize}`.trim()
      : '',
    options.aspectLabel?.trim() || '',
  ].filter(Boolean).join(' / ');

  useLayoutEffect(() => {
    let alive = true;
    let finished = false;
    let loadId = 0;
    let sourceImage: HTMLImageElement | null = null;
    let loadingImage: HTMLImageElement | null = null;
    let state: EditorView | null = null;
    const pointers = new Map<number, Point>();
    let drag: { x: number; y: number; tx: number; ty: number } | null = null;
    let pinch: {
      dist: number;
      scale: number;
      tx: number;
      ty: number;
      cx: number;
      cy: number;
    } | null = null;

    setClosed(false);
    setBusy(false);
    setEditor(null);

    const usable = () => alive && !finished;
    const release = pushOverlay(() => {
      cancel();
      return true;
    });

    function detachLoadingImage() {
      if (!loadingImage) return;
      loadingImage.onload = null;
      loadingImage.onerror = null;
      loadingImage = null;
    }

    function clearPointers() {
      const element = viewport.current;
      for (const id of pointers.keys()) {
        try {
          element?.releasePointerCapture?.(id);
        } catch {
          // 照 A pointer 結束流程：失去 capture 仍清理手勢。
        }
      }
      pointers.clear();
      drag = null;
      pinch = null;
    }

    function finish() {
      finished = true;
      loadId += 1;
      detachLoadingImage();
      clearPointers();
      release();
      if (alive) setClosed(true);
    }

    function cancel() {
      if (!usable()) return;
      finish();
      callbacks.current.onCancel();
    }

    function publish() {
      if (usable() && state) setEditor({ ...state });
    }

    function clampPosition() {
      if (!state) return;
      const clampAxis = (position: number, frame: number, size: number) =>
        size <= frame
          ? Math.min(frame - size, Math.max(0, position))
          : Math.min(0, Math.max(frame - size, position));
      state.tx = clampAxis(state.tx, state.vpW, state.imgW * state.scale);
      state.ty = clampAxis(state.ty, state.vpH, state.imgH * state.scale);
    }

    function reset() {
      if (!usable() || !sourceImage || !state) return;
      clearPointers();
      const naturalW = sourceImage.naturalWidth || sourceImage.width || 1;
      const naturalH = sourceImage.naturalHeight || sourceImage.height || 1;
      const fitScale = Math.max(state.vpW / naturalW, state.vpH / naturalH);
      state.imgW = Math.max(1, naturalW * fitScale);
      state.imgH = Math.max(1, naturalH * fitScale);
      state.scale = 1;
      state.tx = Math.round((state.vpW - state.imgW) / 2);
      state.ty = Math.round((state.vpH - state.imgH) / 2);
      clampPosition();
      publish();
    }

    function setScale(nextScale: number, originX?: number, originY?: number) {
      if (!usable() || !state) return;
      const oldScale = state.scale || 1;
      const scale = Math.max(minZoom, Math.min(maxZoom, Number(nextScale) || 1));
      if (Math.abs(scale - oldScale) < 0.001) return;
      const x = originX ?? state.vpW / 2;
      const y = originY ?? state.vpH / 2;
      const ratio = scale / oldScale;
      state.tx = x - (x - state.tx) * ratio;
      state.ty = y - (y - state.ty) * ratio;
      state.scale = scale;
      clampPosition();
      publish();
    }

    function loadSource(url: string) {
      if (!usable()) return;
      detachLoadingImage();
      clearPointers();
      sourceImage = null;
      state = null;
      setEditor(null);
      const request = ++loadId;
      const image = new Image();
      loadingImage = image;

      image.onload = () => {
        if (!usable() || request !== loadId) return;
        image.onload = null;
        image.onerror = null;
        loadingImage = null;
        sourceImage = image;

        // 照 A _cropperComputeViewport。
        const naturalW = image.naturalWidth || image.width || 1;
        const naturalH = image.naturalHeight || image.height || 1;
        const ratio = aspectRatio || naturalW / naturalH || 1;
        const maxW = Math.max(220, Math.min(window.innerWidth - 76, 760));
        const maxH = Math.max(
          180,
          Math.min(window.innerHeight - 330, window.innerHeight * 0.58, 560),
        );
        let width: number;
        let height: number;
        if (maxW / ratio <= maxH) {
          width = maxW;
          height = maxW / ratio;
        } else {
          height = maxH;
          width = maxH * ratio;
        }
        const minW = Math.min(maxW, 220);
        const minH = Math.min(maxH, 140);
        if (width < minW && minW / ratio <= maxH) {
          width = minW;
          height = width / ratio;
        }
        if (height < minH && minH * ratio <= maxW) {
          height = minH;
          width = height * ratio;
        }
        state = {
          src: image.src,
          vpW: Math.max(1, Number(width.toFixed(2))),
          vpH: Math.max(1, Number(height.toFixed(2))),
          imgW: 1,
          imgH: 1,
          scale: 1,
          tx: 0,
          ty: 0,
        };
        reset();
      };
      image.onerror = () => {
        if (!usable() || request !== loadId) return;
        toast.show({
          message: lt('圖片讀取失敗，請換一張圖片', '圖片讀取失敗，請換一張圖片'),
          tone: 'error',
        });
        cancel();
      };
      image.src = url;
    }

    function rotate() {
      if (!usable() || !sourceImage) return;
      try {
        // 照 A _cropperRotateSource。
        const naturalW = sourceImage.naturalWidth || sourceImage.width;
        const naturalH = sourceImage.naturalHeight || sourceImage.height;
        const canvas = document.createElement('canvas');
        canvas.width = naturalH;
        canvas.height = naturalW;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D unavailable');
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(sourceImage, -naturalW / 2, -naturalH / 2, naturalW, naturalH);
        ctx.restore();
        let result = canvas.toDataURL(outputType, quality);
        if (outputType === 'image/webp' && !result.startsWith('data:image/webp')) {
          result = canvas.toDataURL('image/jpeg', quality);
        }
        loadSource(result);
      } catch {
        if (!usable()) return;
        toast.show({ message: lt('圖片旋轉失敗', '圖片旋轉失敗'), tone: 'error' });
      }
    }

    function confirm() {
      if (!usable() || !sourceImage || !state) return;
      let result: string;
      try {
        setBusy(true);
        // 照 A _cropperRenderResult。
        const canvas = document.createElement('canvas');
        const outputH = Math.max(
          240,
          Math.min(2400, outputHeight || Math.round(outputWidth * state.vpH / state.vpW)),
        );
        canvas.width = outputWidth;
        canvas.height = outputH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D unavailable');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (outputType === 'image/jpeg') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, outputWidth, outputH);
        }
        const naturalW = sourceImage.naturalWidth || sourceImage.width || 1;
        const naturalH = sourceImage.naturalHeight || sourceImage.height || 1;
        const canvasScale = Math.min(outputWidth / state.vpW, outputH / state.vpH);
        const offsetX = (outputWidth - state.vpW * canvasScale) / 2;
        const offsetY = (outputH - state.vpH * canvasScale) / 2;
        ctx.drawImage(
          sourceImage,
          0,
          0,
          naturalW,
          naturalH,
          offsetX + state.tx * canvasScale,
          offsetY + state.ty * canvasScale,
          state.imgW * state.scale * canvasScale,
          state.imgH * state.scale * canvasScale,
        );
        result = canvas.toDataURL(outputType, quality);
        if (outputType === 'image/webp' && !result.startsWith('data:image/webp')) {
          result = canvas.toDataURL('image/jpeg', quality);
        }
      } catch {
        if (!usable()) return;
        setBusy(false);
        toast.show({
          message: lt('圖片處理失敗，請重試', '圖片處理失敗，請重試'),
          tone: 'error',
        });
        return;
      }
      finish();
      callbacks.current.onConfirm(result);
    }

    function startPinch() {
      if (!state || !viewport.current) return;
      const [p1, p2] = [...pointers.values()];
      if (!p1 || !p2) return;
      const rect = viewport.current.getBoundingClientRect();
      pinch = {
        dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
        scale: state.scale,
        tx: state.tx,
        ty: state.ty,
        cx: (p1.x + p2.x) / 2 - rect.left,
        cy: (p1.y + p2.y) / 2 - rect.top,
      };
    }

    actions.current = {
      cancel,
      confirm,
      reset,
      rotate,
      scale: setScale,
      zoom: (delta) => {
        if (state) setScale(state.scale + delta);
      },
      down: (event) => {
        if (!usable() || !state || !viewport.current) return;
        event.preventDefault();
        try {
          viewport.current.setPointerCapture?.(event.pointerId);
        } catch {
          // 照 A pointer 流程：不支援 capture 時仍可操作。
        }
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 1) {
          drag = { x: event.clientX, y: event.clientY, tx: state.tx, ty: state.ty };
          pinch = null;
        } else if (pointers.size === 2) {
          drag = null;
          startPinch();
        }
      },
      move: (event) => {
        if (!usable() || !state || !pointers.has(event.pointerId)) return;
        event.preventDefault();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 1 && drag) {
          state.tx = drag.tx + event.clientX - drag.x;
          state.ty = drag.ty + event.clientY - drag.y;
          clampPosition();
          publish();
          return;
        }
        if (pointers.size >= 2 && pinch && viewport.current) {
          const [p1, p2] = [...pointers.values()];
          if (!p1 || !p2) return;
          const rect = viewport.current.getBoundingClientRect();
          const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
          const scale = Math.max(
            minZoom,
            Math.min(maxZoom, pinch.scale * distance / pinch.dist),
          );
          const ratio = scale / pinch.scale;
          state.scale = scale;
          state.tx = (p1.x + p2.x) / 2 - rect.left - (pinch.cx - pinch.tx) * ratio;
          state.ty = (p1.y + p2.y) / 2 - rect.top - (pinch.cy - pinch.ty) * ratio;
          clampPosition();
          publish();
        }
      },
      end: (event) => {
        if (!usable() || !state) return;
        pointers.delete(event.pointerId);
        try {
          viewport.current?.releasePointerCapture?.(event.pointerId);
        } catch {
          // 照 A pointer 結束流程：capture 已釋放時不阻擋清理。
        }
        const [remaining] = [...pointers.values()];
        if (pointers.size >= 2) {
          drag = null;
          startPinch();
        } else if (remaining) {
          drag = { ...remaining, tx: state.tx, ty: state.ty };
          pinch = null;
        } else {
          drag = null;
          pinch = null;
        }
      },
      wheel: (event) => {
        if (!usable() || !state || !viewport.current) return;
        event.preventDefault();
        const rect = viewport.current.getBoundingClientRect();
        setScale(
          state.scale * (event.deltaY < 0 ? 1.08 : 0.92),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      },
    };

    if (src) loadSource(src);
    else cancel();

    return () => {
      alive = false;
      finished = true;
      loadId += 1;
      detachLoadingImage();
      clearPointers();
      release();
      actions.current = null;
    };
  }, [src, aspectRatio, outputWidth, outputHeight, outputType, quality, minZoom, maxZoom, lt]);

  const imageSrc = editor?.src;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || closed) return;
    const onWheel = (event: WheelEvent) => actions.current?.wheel(event);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [imageSrc, closed]);

  if (closed) return null;

  return createPortal(
    <div class="legacy-ui image-cropper-open">
      <div class="image-cropper-overlay">
        <div class="image-cropper-panel" role="dialog" aria-modal="true">
          <div class="image-cropper-header">
            <div class="image-cropper-heading">
              <div class="image-cropper-title">{lt(title, title)}</div>
              <div class="image-cropper-subtitle">{lt(subtitle, subtitle)}</div>
            </div>
            <button
              type="button"
              class="image-cropper-icon-btn image-cropper-btn--close"
              aria-label={lt('Close', 'Close')}
              onClick={() => actions.current?.cancel()}
            >{lt('×', '×')}</button>
          </div>
          <div class="image-cropper-workspace">
            {editor ? (
              <>
                {frameHint && <div class="image-cropper-frame-meta">{frameHint}</div>}
                <div
                  ref={viewport}
                  class="image-cropper-viewport"
                  style={{ width: `${editor.vpW}px`, height: `${editor.vpH}px` }}
                  onPointerDown={(event) => actions.current?.down(event)}
                  onPointerMove={(event) => actions.current?.move(event)}
                  onPointerUp={(event) => actions.current?.end(event)}
                  onPointerCancel={(event) => actions.current?.end(event)}
                >
                  <img
                    class="image-cropper-image"
                    alt=""
                    src={editor.src}
                    style={{
                      width: `${editor.imgW}px`,
                      height: `${editor.imgH}px`,
                      transform: `translate3d(${editor.tx}px,${editor.ty}px,0) scale(${editor.scale})`,
                    }}
                  />
                  <div class="image-cropper-grid" aria-hidden="true" />
                </div>
              </>
            ) : (
              <div class="image-cropper-loading">
                {lt('載入圖片中...', '載入圖片中...')}
              </div>
            )}
          </div>
          <div class="image-cropper-controls">
            <div class="image-cropper-tool-row">
              <button
                type="button"
                class="image-cropper-tool"
                data-action="zoom-out"
                aria-label={lt('Zoom out', 'Zoom out')}
                onClick={() => actions.current?.zoom(-0.12)}
              >{lt('-', '-')}</button>
              <input
                type="range"
                class="image-cropper-zoom-slider"
                min={Math.round(minZoom * 100)}
                max={Math.round(maxZoom * 100)}
                value={Math.round((editor?.scale ?? 1) * 100)}
                onInput={(event) =>
                  actions.current?.scale(Number(event.currentTarget.value) / 100)}
              />
              <button
                type="button"
                class="image-cropper-tool"
                data-action="zoom-in"
                aria-label={lt('Zoom in', 'Zoom in')}
                onClick={() => actions.current?.zoom(0.12)}
              >{lt('+', '+')}</button>
              <span class="image-cropper-zoom-value">
                {lt('{zoom}%', '{zoom}%', { zoom: Math.round((editor?.scale ?? 1) * 100) })}
              </span>
            </div>
            <div class="image-cropper-tool-row image-cropper-tool-row--secondary">
              <button
                type="button"
                class="image-cropper-tool image-cropper-tool--wide"
                data-action="rotate"
                onClick={() => actions.current?.rotate()}
              >{lt(rotateLabel, rotateLabel)}</button>
              <button
                type="button"
                class="image-cropper-tool image-cropper-tool--wide"
                data-action="reset"
                onClick={() => actions.current?.reset()}
              >{lt(resetText, resetText)}</button>
            </div>
          </div>
          <div class="image-cropper-actions">
            <button
              type="button"
              class="image-cropper-btn image-cropper-btn--cancel"
              onClick={() => actions.current?.cancel()}
            >{lt(cancelText, cancelText)}</button>
            <button
              type="button"
              class="image-cropper-btn image-cropper-btn--confirm"
              disabled={busy}
              onClick={() => actions.current?.confirm()}
            >{lt(confirmText, confirmText)}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

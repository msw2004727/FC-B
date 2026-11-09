import '../legacy/activity.css';
import type { ComponentType, JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { pushOverlay } from '@/core/overlay-back';
import type { ViewerView } from '@/features/profile/data/viewer';
import { useLegacyT } from '@/i18n/i18n';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';
import { ActionRingButton, useActionRingControl } from '@/ui/action-ring';
import { operateContextFromViewer } from '../data/event-create-context';
import { roleLabelOf } from '../data/event-form-model';
import { canEditOwnActivityBasic } from '../data/operate-permissions';
import {
  EXTERNAL_EDIT_FAILED, ExternalEventEditError, externalEventEditForm,
  saveExternalEventEdit, validateExternalEventEdit, type ExternalEventEditForm,
} from '../data/external-event-edit';
import type { EventDoc } from '../data/types';
import { SportTagPicker } from './event-form/SportTagPicker';
import { useEventLocation } from './event-form/use-event-location';
import type { ImageCropperProps } from './event-form/ImageCropper';

export interface ExternalEventEditModalProps {
  event: EventDoc;
  viewer: ViewerView;
  onClose(): void;
  onSaved(): void;
}

/** 只在開窗時掛載；A #create-external-event-modal 去除兩處範本列。 */
export function ExternalEventEditModal(props: ExternalEventEditModalProps): JSX.Element {
  const lt = useLegacyT();
  const [form, setForm] = useState(() => externalEventEditForm(props.event));
  const [submitting, setSubmitting] = useState(false);
  // 「儲存修改」進度環：本地檢查通過才轉，成功打勾後才關窗。
  const submitRing = useActionRingControl();
  const [readingImage, setReadingImage] = useState(false);
  const [crop, setCrop] = useState<{ src: string; Component: ComponentType<ImageCropperProps> } | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  const imageRequest = useRef(0);
  const reader = useRef<FileReader | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  // A cee 沒有 GPS 開關，直接使用同一草稿／picker，payload 排除 gpsEnabled。
  const location = useEventLocation({ locationText: form.location, gpsEnabled: true });

  function message(text: string): void {
    toast.show({ message: lt(text, text), tone: 'error' });
  }
  function close(): boolean {
    if (busy.current) {
      message('資料儲存中，請稍候');
      return false;
    }
    alive.current = false;
    latest.current.onClose();
    return true;
  }
  const closeRef = useRef(close);
  closeRef.current = close;

  useLayoutEffect(() => {
    alive.current = true;
    location.reset(props.event as Record<string, unknown>);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockBody(document.body);
    const release = pushOverlay(() => closeRef.current());
    panel.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
      imageRequest.current += 1;
      reader.current?.abort();
      release();
      unlock();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  function patch(value: Partial<ExternalEventEditForm>): void {
    if (!busy.current && alive.current) setForm(previous => ({ ...previous, ...value }));
  }

  async function pickImage(file: File): Promise<void> {
    if (busy.current) return;
    const request = ++imageRequest.current;
    reader.current?.abort();
    setCrop(null);
    const types = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
    // A 的提示仍寫 2MB；實際 bindImageUpload 上限為 5MB，MIME／副檔名擇一符合。
    if (!types.includes(file.type.toLowerCase())
      && !extensions.includes(file.name.split('.').pop()?.toLowerCase() || '')) {
      setReadingImage(false);
      message('請上傳 JPG / PNG / WebP 圖片');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setReadingImage(false);
      message('圖片太大，不能超過 5MB');
      return;
    }
    setReadingImage(true);
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const next = new FileReader();
        reader.current = next;
        next.onload = () => typeof next.result === 'string' && next.result
          ? resolve(next.result) : reject(new Error());
        next.onerror = next.onabort = () => reject(new Error());
        next.readAsDataURL(file);
      });
      const { ImageCropper } = await import('./event-form/ImageCropper');
      if (alive.current && imageRequest.current === request) setCrop({ src, Component: ImageCropper });
    } catch {
      if (alive.current && imageRequest.current === request) message('圖片處理失敗，請重試');
    } finally {
      if (alive.current && imageRequest.current === request) setReadingImage(false);
    }
  }
  const pickRef = useRef(pickImage);
  pickRef.current = pickImage;
  // 與 A 相同使用原生 change；在 Portal input 掛載時綁定。
  function bindFileInput(input: HTMLInputElement | null): void {
    if (fileInput.current) fileInput.current.onchange = null;
    fileInput.current = input;
    if (input) input.onchange = () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) void pickRef.current(file);
    };
  }

  async function submit(): Promise<void> {
    if (!alive.current || readingImage || crop) return;
    if (busy.current) { message('活動建立中，請勿重複送出'); return; }
    if (!canEditOwnActivityBasic(operateContextFromViewer(latest.current.viewer), props.event)) {
      message('權限不足'); return;
    }
    const validation = validateExternalEventEdit(form);
    if (validation) { message(validation); return; }
    busy.current = true;
    setSubmitting(true);
    submitRing.start();
    let saved: { title: string };
    try {
      saved = await saveExternalEventEdit(props.event, form, location.buildValue(new Date()), () => {
        if (!alive.current) throw new ExternalEventEditError('權限不足');
        const viewer = latest.current.viewer;
        return {
          context: operateContextFromViewer(viewer),
          operator: viewer.displayName?.trim()
            || roleLabelOf(viewer.role, viewer.permissionSources?.customRoles ?? []) || '系統',
        };
      });
      // 仍在送出鎖內等 ✓ 停留完（期間不能關窗或重送），之後照原流程提示並關窗。
      if (alive.current) await submitRing.succeed();
    } catch (error) {
      submitRing.fail();
      if (alive.current) message(error instanceof ExternalEventEditError ? error.userMessage : EXTERNAL_EDIT_FAILED);
      return;
    } finally {
      submitRing.fail();
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
    if (!alive.current) return;
    toast.show({ message: lt('活動連結「{title}」已更新！', '活動連結「{title}」已更新！', { title: saved.title }) });
    // 重新載入屬已完成寫入的後續流程，不把刷新失敗誤報為儲存失敗。
    latest.current.onClose();
    latest.current.onSaved();
  }

  const loc = location.view;
  return createPortal(
    <div class="legacy-ui">
      <div id="modal-overlay" class="modal-overlay open" />
      <div class="modal open" id="create-external-event-modal" data-no-backdrop-close="1"
        role="dialog" aria-modal="true" aria-labelledby="cee-modal-title" aria-busy={submitting || undefined}
        tabIndex={-1} ref={panel}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); close();
          }
          if (event.key !== 'Tab' || !panel.current) return;
          const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button, input, [tabindex]'))
            .filter(el => el.tabIndex >= 0 && !el.matches(':disabled, [type="hidden"]') && el.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) { event.preventDefault(); panel.current.focus(); }
          else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
      >
        <div class="modal-header">
          <h3 id="cee-modal-title">{lt('編輯活動連結')}</h3>
          <button type="button" class="modal-close" onClick={close}>✕</button>
        </div>
        <div class="modal-body">
          <div class="ce-form">
            <div class="ce-row">
              <label>{lt('活動封面圖片')}</label>
              <div class="ce-upload" id="cee-upload-area">
                <input type="file" id="cee-image" accept="image/*" hidden ref={bindFileInput} disabled={submitting} />
                <div class={`ce-upload-placeholder${form.image ? ' has-image' : ''}`} id="cee-upload-preview"
                  role="button" tabIndex={0} aria-label={lt('點擊上傳圖片')} aria-disabled={submitting}
                  onClick={() => { if (!busy.current) fileInput.current?.click(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy.current) fileInput.current?.click(); } }}>
                  {form.image ? <img src={form.image} alt="" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius)" /> : <>
                    <span class="ce-upload-icon">+</span>
                    <span class="ce-upload-text">{lt('點擊上傳圖片')}</span>
                    <span class="ce-upload-hint">{lt('建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB')}</span>
                  </>}
                </div>
              </div>
            </div>
            <div class="ce-row">
              <label for="cee-title">{lt('活動名稱')} <span class="required">{lt('*必填')}</span></label>
              <input type="text" id="cee-title" placeholder={lt('例：XX 平台足球活動')} maxLength={16}
                value={form.title} disabled={submitting} onInput={e => patch({ title: e.currentTarget.value })} />
            </div>
            <div class="ce-row">
              <label>{lt('活動時間')} <span class="required">{lt('*必填')}</span></label>
              <div class="ce-time-row">
                <input type="date" id="cee-date" class="ce-time-date" aria-label={lt('活動日期')}
                  value={form.dateVal} disabled={submitting} onInput={e => patch({ dateVal: e.currentTarget.value })} />
                <input type="time" id="cee-start-time" class="ce-time-clock ce-time-start" step={1800} aria-label={lt('開始時間')}
                  value={form.startTime} disabled={submitting} onInput={e => patch({ startTime: e.currentTarget.value })} />
                <span class="ce-time-separator">~</span>
                <input type="time" id="cee-end-time" class="ce-time-clock ce-time-end" step={1800} aria-label={lt('結束時間')}
                  value={form.endTime} disabled={submitting} onInput={e => patch({ endTime: e.currentTarget.value })} />
              </div>
            </div>
            <div class="ce-row">
              <label for="cee-location">{lt('地點')}</label>
              <input type="text" id="cee-location" placeholder={lt('選填，例：台北市大安運動中心')}
                value={form.location} disabled={submitting} onInput={e => patch({ location: e.currentTarget.value })} />
              <div class="event-location-control" data-prefix="cee">
                <div class="event-location-state-row">
                  <span id="cee-location-status" class="event-location-status" data-state={loc.statusState}>{loc.statusText}</span>
                  <button type="button" id="cee-location-btn"
                    class={`outline-btn small${loc.buttonLooksDisabled ? ' event-location-btn-disabled' : ''}`}
                    disabled={loc.buttonDisabled || submitting} aria-disabled={loc.buttonLooksDisabled || submitting}
                    onClick={() => {
                      if (!form.location.trim()) { message('請先輸入地點文字'); document.getElementById('cee-location')?.focus(); }
                      else loc.onOpenPicker();
                    }}>{loc.buttonText}</button>
                </div>
                <div id="cee-location-summary" class="event-location-summary">{loc.summary}</div>
                <button type="button" id="cee-location-clear" class="event-location-clear" style={loc.showClear ? '' : 'display:none'}
                  disabled={submitting} onClick={loc.onClear}>{lt('清除定位')}</button>
              </div>
            </div>
            <div class="ce-row">
              <label for="cee-sport-selected">{lt('運動 / 場景標籤')} <span class="required">{lt('*必選')}</span></label>
              <SportTagPicker prefix="cee" value={form.sportTag} onChange={sportTag => patch({ sportTag })} />
              <div class="ce-sport-required-tip">{lt('* 必選，未選擇運動 / 場景標籤將無法儲存')}</div>
            </div>
            <div class="ce-row">
              <label for="cee-external-url">{lt('活動連結')} <span class="required">{lt('*必填')}</span></label>
              <input type="url" id="cee-external-url" placeholder="https://..." maxLength={500}
                value={form.externalUrl} disabled={submitting} onInput={e => patch({ externalUrl: e.currentTarget.value })} />
              <div style="font-size:.68rem;color:var(--text-muted);margin-top:.2rem">{lt('僅限 https:// 開頭的連結')}</div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="outline-btn" onClick={close}>{lt('取消')}</button>
          <ActionRingButton control={submitRing} busyLabel={lt('儲存中...')} type="button" class="primary-btn"
            id="cee-submit-btn" disabled={submitting || readingImage || crop !== null}
            onClick={() => { void submit(); }}>{submitting ? lt('儲存中...') : lt('儲存修改')}</ActionRingButton>
        </div>
      </div>
      {location.picker}
      {crop && <crop.Component src={crop.src} options={{ aspectRatio: 8 / 3, outputWidth: 1200, outputType: 'image/webp', quality: 0.9 }}
        onConfirm={image => { patch({ image }); setCrop(null); }} onCancel={() => setCrop(null)} />}
    </div>, document.body,
  );
}

import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { useLocation } from 'preact-iso';
import { SportIcon } from '@/ui/SportIcon';
import { lockBody } from '@/ui/Modal';
import { pushOverlay } from '@/core/overlay-back';
import { toast } from '@/ui/Toast';
import { batchCells, batchCount, devicePushOn, loadSportRank, orderedSports } from './data';
import { saveSportPrefs, SportPrefsCallError, type SaveSportPrefsResult } from './callables';
import { sportName, useSportPrefsT } from './i18n';
import './sport-prefs.css';

function Check({ locked = false }: { locked?: boolean }): JSX.Element {
  if (locked) {
    return (
      <span class="spf-check" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="11" height="11"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="currentColor" /><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.8" /></svg>
      </span>
    );
  }
  return (
    <span class="spf-check" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.6 8.4l2.9 2.8 5.9-6.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </span>
  );
}

export interface SportPrefsModalProps {
  uid: string;
  owned: readonly string[];
  onClose: () => void;
  onSaved: (r: SaveSportPrefsResult) => void;
  /** 按 X 或按確認時呼叫一次；點背景、返回鍵不呼叫 */
  onSeen?: (saved: boolean) => void;
}

export function SportPrefsModal({ owned, onClose, onSaved, onSeen }: SportPrefsModalProps): JSX.Element {
  const t = useSportPrefsT();
  const { route } = useLocation();
  const [rank, setRank] = useState<string[]>([]);
  const [batch, setBatch] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [step, setStep] = useState<'pick' | 'saved'>('pick');
  const [savedTags, setSavedTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const seenRef = useRef(false);
  const seen = (saved: boolean): void => {
    if (seenRef.current) return;
    seenRef.current = true;
    onSeenRef.current?.(saved);
  };

  const list = useMemo(() => orderedSports(rank), [rank]);
  const pages = batchCount(list.length);
  const cells = batchCells(list, batch);

  const close = useCallback(() => {
    onCloseRef.current();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const unlock = lockBody(document.body);
    document.body.classList.add('sport-prefs-open');
    const pop = pushOverlay(() => {
      close();
      return true;
    });
    return () => {
      mountedRef.current = false;
      pop();
      document.body.classList.remove('sport-prefs-open');
      unlock();
    };
  }, [close]);

  useEffect(() => {
    let alive = true;
    loadSportRank()
      .then((r) => {
        if (!alive) return;
        if (!dirtyRef.current) setRank(r);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (k: string): void => {
    dirtyRef.current = true;
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  };

  const onMore = (): void => {
    dirtyRef.current = true;
    setBatch((b) => (b + 1) % pages);
  };

  const onConfirm = async (): Promise<void> => {
    if (saving) return;
    if (picked.length === 0) {
      seen(false);
      close();
      return;
    }
    setSaving(true);
    try {
      const result = await saveSportPrefs({ addSports: picked });
      // 存檔成功就算看過；存檔途中彈窗被關掉也照記（伺服器已記下）
      seen(true);
      if (!mountedRef.current) return;
      setSavedTags(result.favSports);
      setStep('saved');
      onSaved(result);
    } catch (err) {
      if (!mountedRef.current) return;
      const code = err instanceof SportPrefsCallError
        ? err.code
        : err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
          ? (err as { code: string }).code
          : 'internal';
      toast.show({ message: code === 'resource-exhausted' ? t('limit') : t('saveFailed'), tone: 'error' });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const onPush = (): void => {
    close();
    // focus=push：個人頁展開通知面板後捲到「手機／電腦通知」列（profile/components/legacy/push-focus.ts；2026-11-27）。
    route('/profile?open=line&focus=push');
  };

  const pushOn = step === 'saved' ? devicePushOn() : false;

  return createPortal(
    <div class="legacy-ui">
      <div class="modal-overlay open" onClick={close} />
      <div class="modal open" id="sport-prefs-modal" role="dialog" aria-modal="true" aria-labelledby="spf-title">
        <div class="modal-header">
          <h3 id="spf-title">{step === 'pick' ? t('title') : t('saved')}</h3>
          <button type="button" class="modal-close" aria-label={t('close')} onClick={() => { seen(false); close(); }}>✕</button>
        </div>
        {step === 'pick' ? (
          <>
            <div class="modal-body spf-body">
              <div class="spf-grid" role="group" aria-label={t('group')}>
                {cells.map((s, i) => {
                  if (!s) return <span key={`e${i}`} class="spf-tile is-empty" aria-hidden="true" />;
                  const isOwned = owned.includes(s.key);
                  const on = isOwned || picked.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      role="checkbox"
                      aria-checked={on ? 'true' : 'false'}
                      aria-disabled={isOwned ? 'true' : undefined}
                      class={`spf-tile${on ? ' is-on' : ''}${isOwned ? ' is-owned' : ''}`}
                      onClick={() => {
                        if (!isOwned) toggle(s.key);
                      }}
                    >
                      <SportIcon sportKey={s.key} className="spf-icon" />
                      <span class={`spf-name${sportName(t, s.key).length > 6 ? ' is-long' : ''}`}>{sportName(t, s.key)}</span>
                      {on ? <Check locked={isOwned} /> : null}
                    </button>
                  );
                })}
              </div>
              <div class="spf-dots" aria-label={t('batch', { n: batch + 1, total: pages })}>
                {Array.from({ length: pages }, (_, i) => <span key={i} class={i === batch ? 'on' : undefined} />)}
              </div>
              <div class="spf-tags" aria-live="polite">
                {owned.map((k) => <span key={k} class="spf-tag is-owned">{sportName(t, k)}</span>)}
                {picked.map((k) => (
                  <button
                    key={k}
                    type="button"
                    class="spf-tag"
                    aria-label={t('unpick', { name: sportName(t, k) })}
                    onClick={() => toggle(k)}
                  >
                    {sportName(t, k)}<span class="spf-tag-x" aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            </div>
            <div class="modal-actions spf-actions">
              <button type="button" class="outline-btn spf-more" onClick={onMore}>{t('more')}</button>
              <button
                type="button"
                class={`primary-btn spf-ok${saving ? ' is-saving' : ''}`}
                disabled={saving}
                aria-busy={saving || undefined}
                onClick={() => {
                  void onConfirm();
                }}
              >
                <span class="spf-ok-label">{t('confirm')}</span>
                {saving ? (
                  // 同 ui/Button.tsx 載入中的 ui-button__spinner（裝飾性 inline SVG）
                  <svg class="spf-ok-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
                    <path d="M12 3a9 9 0 1 1-9 9" />
                  </svg>
                ) : null}
              </button>
            </div>
          </>
        ) : (
          <div class="modal-body spf-saved">
            <div class="spf-saved-tags">
              {savedTags.map((k) => <span key={k} class="spf-tag is-owned">{sportName(t, k)}</span>)}
            </div>
            {pushOn ? null : (
              <>
                <p class="spf-saved-hint">{t('pushHint')}</p>
                <button type="button" class="primary-btn spf-push-btn" onClick={onPush}>{t('pushBtn')}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default SportPrefsModal;

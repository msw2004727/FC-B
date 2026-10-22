import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { useGoBack } from '@/core/back-guard';
import { getFirebase } from '@/data/firebase';
import { useViewer } from '@/features/profile/data/viewer';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';

import {
  evaluateFromProgress,
  getTitleOptions,
  loadAchievementDefs,
  loadUserAchievementProgress,
  splitPendingCompleted,
} from '../data/achievements';
import { saveTitles } from '../data/titles-write';

// A 的 .title-config／.title-tag 樣式在 profile.css。
import '@/features/profile/legacy/profile.css';

interface UserDocData {
  titleBig: unknown;
  titleNormal: unknown;
  displayName: string;
}

async function loadUserDoc(uid: string): Promise<UserDocData | null> {
  const [{ doc, getDoc }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    titleBig: data['titleBig'],
    titleNormal: data['titleNormal'],
    displayName: typeof data['displayName'] === 'string' ? data['displayName'] : '',
  };
}

export default function TitlesPage(): JSX.Element {
  const lt = useLegacyT();
  const goBack = useGoBack('/');
  const { uid } = useViewer();

  const [loading, setLoading] = useState(true);
  const [bigOptions, setBigOptions] = useState<string[]>([]);
  const [normalOptions, setNormalOptions] = useState<string[]>([]);
  const [selectedBig, setSelectedBig] = useState('');
  const [selectedNormal, setSelectedNormal] = useState('');
  const [lineName, setLineName] = useState('-');
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!uid) {
      // 登入狀態尚未恢復：維持載入中，不顯示表單與「載入失敗」。
      setLoading(true);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setBigOptions([]);
    setNormalOptions([]);
    setSelectedBig('');
    setSelectedNormal('');
    setLineName('-');
    (async () => {
      try {
        const [userDoc, defs, progress] = await Promise.all([
          loadUserDoc(uid),
          loadAchievementDefs(),
          loadUserAchievementProgress(uid),
        ]);
        if (cancelled) return;
        const evaluated = evaluateFromProgress(defs.achievements, progress);
        const { completed } = splitPendingCompleted(evaluated);
        const opts = getTitleOptions(completed);
        setBigOptions(opts.big);
        setNormalOptions(opts.normal);
        const currentBig =
          typeof userDoc?.titleBig === 'string' && opts.big.includes(userDoc.titleBig)
            ? userDoc.titleBig
            : '';
        const currentNormal =
          typeof userDoc?.titleNormal === 'string' && opts.normal.includes(userDoc.titleNormal)
            ? userDoc.titleNormal
            : '';
        setSelectedBig(currentBig);
        setSelectedNormal(currentNormal);
        setLineName(userDoc?.displayName || '-');
      } catch (err) {
        if (cancelled) return;
        // 讀取失敗不當成空進度：清空可選稱號並禁止儲存。
        setLoadError(true);
        setBigOptions([]);
        setNormalOptions([]);
        setSelectedBig('');
        setSelectedNormal('');
        setLineName('-');
        // eslint-disable-next-line no-console
        console.warn('[titles] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, reloadTick]);

  const handleSave = async (): Promise<void> => {
    if (submitting || loading || loadError) return;
    // 用 hook 當下最新的登入 uid；資料層 saveTitles 仍會與 auth.currentUser 比對防線。
    if (!uid) {
      toast.show({ message: lt('儲存失敗，請重試', '儲存失敗，請重試') });
      return;
    }
    if (
      (selectedBig !== '' && !bigOptions.includes(selectedBig))
      || (selectedNormal !== '' && !normalOptions.includes(selectedNormal))
    ) {
      toast.show({ message: lt('儲存失敗，請重試', '儲存失敗，請重試') });
      return;
    }
    setSubmitting(true);
    try {
      await saveTitles(uid, selectedBig || null, selectedNormal || null);
      toast.show({ message: lt('稱號已儲存', '稱號已儲存') });
    } catch (err) {
      // 照 A：失敗不寫入、不跳頁；此處僅提示。
      // eslint-disable-next-line no-console
      console.warn('[titles] save failed', err);
      toast.show({ message: lt('儲存失敗，請重試', '儲存失敗，請重試') });
    } finally {
      setSubmitting(false);
    }
  };

  const header = (
    <div class="page-header">
      <button
        class="back-btn"
        type="button"
        aria-label={lt('返回', '返回')}
        data-i18n-aria-label="返回"
        onClick={goBack}
      >
        <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M15 6l-6 6 6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <h2 data-i18n="稱號設定">{lt('稱號設定', '稱號設定')}</h2>
    </div>
  );

  if (!uid) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-titles">
          {header}
          <div class="title-config">
            <div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">
              {lt('載入中...', '載入中...')}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-titles">
        {header}
        <div class="title-config">
          {loadError ? (
            <div style="padding:1rem;text-align:center">
              <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:.75rem">
                {lt('載入失敗，請重新整理', '載入失敗，請重新整理')}
              </div>
              <button
                class="primary-btn full-width"
                type="button"
                onClick={() => setReloadTick((n) => n + 1)}
              >
                {lt('重新整理', '重新整理')}
              </button>
            </div>
          ) : (
            <>
          <div class="title-preview" id="title-preview">
            {selectedBig ? (
              <>
                <span class="title-tag title-gold">{selectedBig}</span>
                <span class="title-dot">·</span>
              </>
            ) : null}
            {selectedNormal ? (
              <>
                <span class="title-tag title-normal">{selectedNormal}</span>
                <span class="title-dot">·</span>
              </>
            ) : null}
            <span>{lineName || '-'}</span>
          </div>
          <div class="title-row">
            <label data-i18n="大成就稱號">{lt('大成就稱號', '大成就稱號')}</label>
            <select
              id="title-big"
              value={selectedBig}
              onChange={(e) => setSelectedBig(e.currentTarget.value)}
            >
              <option value="">{lt('（無）', '（無）')}</option>
              {bigOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div class="title-row">
            <label data-i18n="普通稱號">{lt('普通稱號', '普通稱號')}</label>
            <select
              id="title-normal"
              value={selectedNormal}
              onChange={(e) => setSelectedNormal(e.currentTarget.value)}
            >
              <option value="">{lt('（無）', '（無）')}</option>
              {normalOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div class="title-row">
            <label data-i18n="LINE 暱稱">{lt('LINE 暱稱', 'LINE 暱稱')}</label>
            <input type="text" id="title-line-name" value={lineName} disabled />
          </div>
          <button
            class="primary-btn full-width"
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={submitting || loading || loadError}
            data-i18n="儲存稱號"
          >
            {lt('儲存稱號', '儲存稱號')}
          </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

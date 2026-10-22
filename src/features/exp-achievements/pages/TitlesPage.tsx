import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { useGoBack } from '@/core/back-guard';
import { getFirebase } from '@/data/firebase';
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

// ASSUMPTION: `getFirebase()` 回傳物件含 `auth`；`auth.currentUser.uid` 為目前登入 UID。
async function getCurrentUid(): Promise<string | null> {
  try {
    const fb = (await getFirebase()) as unknown as {
      auth?: { currentUser?: { uid?: string } | null } | null;
    };
    return fb.auth?.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

interface UserDocData {
  titleBig: unknown;
  titleNormal: unknown;
  displayName: string;
}

async function loadUserDoc(uid: string): Promise<UserDocData | null> {
  try {
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
  } catch {
    return null;
  }
}

export default function TitlesPage(): JSX.Element {
  const lt = useLegacyT();
  const goBack = useGoBack('/');

  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  const [bigOptions, setBigOptions] = useState<string[]>([]);
  const [normalOptions, setNormalOptions] = useState<string[]>([]);
  const [selectedBig, setSelectedBig] = useState('');
  const [selectedNormal, setSelectedNormal] = useState('');
  const [lineName, setLineName] = useState('-');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const currentUid = await getCurrentUid();
        if (cancelled) return;
        setUid(currentUid);
        if (!currentUid) {
          setLoading(false);
          return;
        }
        const [userDoc, defs, progress] = await Promise.all([
          loadUserDoc(currentUid),
          loadAchievementDefs(),
          loadUserAchievementProgress(currentUid),
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
        // eslint-disable-next-line no-console
        console.warn('[titles] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (): Promise<void> => {
    if (!uid || submitting) return;
    setSubmitting(true);
    try {
      await saveTitles(uid, selectedBig || null, selectedNormal || null);
      toast.show({ message: lt('稱號已儲存', '稱號已儲存') });
    } catch (err) {
      // 照 A：失敗不寫入、不跳頁；此處僅提示。
      // eslint-disable-next-line no-console
      console.warn('[titles] save failed', err);
      toast.show({ message: lt('儲存失敗', '儲存失敗') });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-titles">
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
        <div class="title-config">
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
            disabled={submitting || loading}
            data-i18n="儲存稱號"
          >
            {lt('儲存稱號', '儲存稱號')}
          </button>
        </div>
      </section>
    </div>
  );
}

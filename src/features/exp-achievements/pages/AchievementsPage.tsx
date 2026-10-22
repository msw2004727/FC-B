import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { useGoBack } from '@/core/back-guard';
import { getFirebase } from '@/data/firebase';
import { useLegacyT } from '@/i18n/i18n';

import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  evaluateFromProgress,
  getAchThreshold,
  getEarnedBadges,
  isSupportedCondition,
  loadAchievementDefs,
  loadUserAchievementProgress,
  splitPendingCompleted,
  type BadgeDef,
  type EvaluatedAchievement,
} from '../data/achievements';

// A 的 .ach-* 樣式在 profile.css。
import '@/features/profile/legacy/profile.css';

/**
 * 照 A `achievement/shared.js#generateConditionDesc` 逐字移植為純函式。
 * B 沒有 A `_getAchievementRegistry` 的 action label／unit／filter label，退回 action 名稱作 label
 * （同 A `actionCfg ? actionCfg.label : condition.action`）。不支援的 condition 顯示「未設定成就條件」。
 */
export function generateConditionDesc(
  condition: Record<string, unknown> | undefined,
  desc: string | undefined,
): string {
  if (!condition) return desc || '未設定成就條件';
  if (!isSupportedCondition(condition)) return '未設定成就條件';
  const actionRaw = condition['action'];
  const actionLabel = typeof actionRaw === 'string' ? actionRaw : '';
  const thresholdRaw = condition['threshold'];
  let threshold = 0;
  if (typeof thresholdRaw === 'number') threshold = thresholdRaw;
  else if (typeof thresholdRaw === 'string') {
    const n = Number(thresholdRaw);
    if (Number.isFinite(n)) threshold = n;
  }
  const timeRangeRaw = condition['timeRange'];
  const timeRange = typeof timeRangeRaw === 'string' ? timeRangeRaw : 'none';
  if (timeRange === 'streak') {
    const daysRaw = condition['streakDays'];
    let days = threshold;
    if (typeof daysRaw === 'number') days = daysRaw;
    else if (typeof daysRaw === 'string') {
      const n = Number(daysRaw);
      if (Number.isFinite(n)) days = n;
    }
    return `連續 ${days} 天${actionLabel}`;
  }
  if (threshold <= 1) return actionLabel;
  return `${actionLabel} ${threshold}`.trim();
}

interface PageData {
  earned: ReturnType<typeof getEarnedBadges>;
  pending: EvaluatedAchievement[];
  completed: EvaluatedAchievement[];
  badges: BadgeDef[];
}

// ASSUMPTION: `getFirebase()` 回傳物件含 `auth`；`auth.currentUser.uid` 為目前登入 UID。
//   若實際形狀不同，PM 可改以 B 的身分 hook 取 UID（R-ID-002 只認 UID）。
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

export default function AchievementsPage(): JSX.Element {
  const lt = useLegacyT();
  const goBack = useGoBack('/');
  const [data, setData] = useState<PageData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = await getCurrentUid();
        if (cancelled) return;
        if (!uid) {
          setData({ earned: [], pending: [], completed: [], badges: [] });
          return;
        }
        const [defs, progress] = await Promise.all([
          loadAchievementDefs(),
          loadUserAchievementProgress(uid),
        ]);
        if (cancelled) return;
        const evaluated = evaluateFromProgress(defs.achievements, progress);
        const { pending, completed } = splitPendingCompleted(evaluated);
        const earned = getEarnedBadges(completed, defs.badges);
        setData({ earned, pending, completed, badges: defs.badges });
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.warn('[achievements] load failed', err);
          setData({ earned: [], pending: [], completed: [], badges: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <h2 data-i18n="成就與徽章">{lt('成就與徽章', '成就與徽章')}</h2>
    </div>
  );

  if (!data) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-achievements">
          {header}
          <div id="achievement-grid" />
        </section>
      </div>
    );
  }

  const { earned, pending, completed, badges } = data;
  const badgeMap = new Map(badges.map((b) => [b.id, b] as const));

  const renderCard = (a: EvaluatedAchievement): JSX.Element => {
    const done = a.done;
    const threshold = getAchThreshold(a);
    const current = a.current || 0;
    const pct = threshold > 0 ? Math.min(100, Math.round((current / threshold) * 100)) : 0;
    const desc = generateConditionDesc(a.condition, a.desc);
    const catColor = CATEGORY_COLORS[a.category] ?? '#b87333';
    const catLabel = CATEGORY_LABELS[a.category] ?? '銅';
    const badge = a.badgeId ? badgeMap.get(a.badgeId) : undefined;
    return (
      <div
        class={`ach-card ${done ? 'ach-card-done' : ''}`}
        style={`border-color:${catColor}`}
        key={a.id}
      >
        <div class={`ach-card-badge ${done ? '' : 'ach-badge-gray'}`}>
          {badge?.image ? (
            <img src={badge.image} alt={badge.name} loading="lazy" />
          ) : (
            <span style="font-size:1.2rem;color:var(--text-muted)">🏅</span>
          )}
          {done ? <div class="ach-card-done-overlay">{lt('已完成', '已完成')}</div> : null}
        </div>
        <div class="ach-card-body">
          <div class="ach-card-top">
            <span class={`ach-cat-chip ach-cat-${a.category}`}>{catLabel}</span>
            <span class="ach-card-name">{a.name}</span>
          </div>
          <div class="ach-card-desc">{desc}</div>
          {done ? (
            <div class="ach-card-completed-date">
              {a.completedAt ? String(a.completedAt) : ''}
            </div>
          ) : (
            <div class="ach-card-progress">
              <div class="ach-bar-mini">
                <div class="ach-bar-fill" style={`width:${pct}%`} />
              </div>
              <span class="ach-card-num">{`${current}/${threshold}`}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const empty = pending.length === 0 && completed.length === 0;

  return (
    <div class="legacy-ui">
      <section class="page active" id="page-achievements">
        {header}
        <div id="achievement-grid">
          {empty ? (
            <div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">
              {lt('尚無成就', '尚無成就')}
            </div>
          ) : (
            <>
              {earned.length > 0 ? (
                <>
                  <div class="ach-section-title">{lt('已獲得徽章', '已獲得徽章')}</div>
                  <div class="ach-badge-showcase">
                    {earned.map(({ badge }) => (
                      <div class="ach-showcase-item" key={badge.id}>
                        <div class="ach-showcase-img">
                          {badge.image ? <img src={badge.image} loading="lazy" /> : <span>🏅</span>}
                        </div>
                        <span class="ach-showcase-name">{badge.name}</span>
                      </div>
                    ))}
                  </div>
                  <div class="ach-divider" />
                </>
              ) : null}
              {pending.length > 0 ? (
                <>
                  <div class="ach-section-title">{lt('進行中', '進行中')}</div>
                  <div class="ach-card-grid">{pending.map(renderCard)}</div>
                </>
              ) : null}
              {pending.length > 0 && completed.length > 0 ? <div class="ach-divider" /> : null}
              {completed.length > 0 ? (
                <>
                  <div class="ach-section-title">{lt('已完成', '已完成')}</div>
                  <div class="ach-card-grid">{completed.map(renderCard)}</div>
                </>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

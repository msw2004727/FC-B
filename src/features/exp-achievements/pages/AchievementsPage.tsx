import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { useGoBack } from '@/core/back-guard';
import { useViewer } from '@/features/profile/data/viewer';
import { useLegacyT } from '@/i18n/i18n';

import {
  ACHIEVEMENT_CONDITIONS,
  type AchievementConditionAction,
  type AchievementConditionFilter,
  type AchievementConditionTimeRange,
} from '../data/achievement-conditions';
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

/** 照 A `_getAchievementRegistry().findActionConfig`。 */
function findActionConfig(key: unknown): AchievementConditionAction | undefined {
  if (typeof key !== 'string') return undefined;
  return ACHIEVEMENT_CONDITIONS.actions.find((a) => a.key === key);
}

/** 照 A `_getAchievementRegistry().findTimeRangeConfig`。 */
function findTimeRangeConfig(key: unknown): AchievementConditionTimeRange | undefined {
  if (typeof key !== 'string') return undefined;
  return ACHIEVEMENT_CONDITIONS.timeRanges.find((t) => t.key === key);
}

/** 照 A `_getAchievementRegistry().findFilterConfig`。 */
function findFilterConfig(key: unknown): AchievementConditionFilter | undefined {
  if (typeof key !== 'string') return undefined;
  return ACHIEVEMENT_CONDITIONS.filters.find((f) => f.key === key);
}

/**
 * 照 A `achievement/shared.js#generateConditionDesc` 逐行移植。
 * 條件描述：streak、`!unit && threshold <= 1` 只回 label、timeText、filterText（僅 filter !== 'all' 且
 * needsFilter 才附）、單位前空格。B 現況：`isSupportedCondition` 不通過時回「未設定成就條件」（保留原行為）。
 */
export function generateConditionDesc(
  condition: Record<string, unknown> | undefined,
  desc: string | undefined,
): string {
  if (!condition) return desc || '未設定成就條件';
  if (!isSupportedCondition(condition)) return '未設定成就條件';

  const actionRaw = condition['action'];
  const timeRangeRaw = condition['timeRange'];
  const filterRaw = condition['filter'];
  const thresholdRaw = condition['threshold'];

  const actionCfg = findActionConfig(actionRaw);
  const timeRangeCfg = findTimeRangeConfig(timeRangeRaw);
  const filterCfg = findFilterConfig(filterRaw);

  const actionLabel = actionCfg ? actionCfg.label : (typeof actionRaw === 'string' ? actionRaw : '');
  const unit = actionCfg ? actionCfg.unit : '';
  let threshold = 0;
  if (typeof thresholdRaw === 'number') threshold = thresholdRaw;
  else if (typeof thresholdRaw === 'string') {
    const n = Number(thresholdRaw);
    if (Number.isFinite(n)) threshold = n;
  }

  const timeRange = typeof timeRangeRaw === 'string' ? timeRangeRaw : 'none';

  if (timeRange === 'streak') {
    const daysRaw = condition['streakDays'];
    let days = threshold;
    if (typeof daysRaw === 'number') days = daysRaw;
    else if (typeof daysRaw === 'string') {
      const n = Number(daysRaw);
      if (Number.isFinite(n)) days = n;
    }
    const filterText =
      filterCfg && filterRaw !== 'all' && actionCfg && actionCfg.needsFilter
        ? ` ${filterCfg.label}`
        : '';
    return `連續 ${days} 天${actionLabel}${filterText}`;
  }

  if (!unit && threshold <= 1) return actionLabel;

  const timeText = timeRangeCfg && timeRange !== 'none' ? timeRangeCfg.label : '';
  const filterText =
    filterCfg && filterRaw !== 'all' && actionCfg && actionCfg.needsFilter
      ? ` ${filterCfg.label}`
      : '';

  if (timeText) {
    return `${timeText}${actionLabel}${filterText} ${threshold}${unit ? ` ${unit}` : ''}`.trim();
  }
  return `${actionLabel}${filterText} ${threshold}${unit ? ` ${unit}` : ''}`.trim();
}

interface PageData {
  earned: ReturnType<typeof getEarnedBadges>;
  pending: EvaluatedAchievement[];
  completed: EvaluatedAchievement[];
  badges: BadgeDef[];
}



export default function AchievementsPage(): JSX.Element {
  const lt = useLegacyT();
  const goBack = useGoBack('/');
  const { uid } = useViewer();
  const [data, setData] = useState<PageData | null>(null);

  useEffect(() => {
    if (!uid) {
      // 登入狀態尚未恢復：維持載入中，不誤顯示「尚無成就」。
      setData(null);
      return;
    }
    let cancelled = false;
    setData(null);
    (async () => {
      try {
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
  }, [uid]);

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

  if (!uid || !data) {
    return (
      <div class="legacy-ui">
        <section class="page active" id="page-achievements">
          {header}
          <div id="achievement-grid">
            <div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">
              {lt('載入中...', '載入中...')}
            </div>
          </div>
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

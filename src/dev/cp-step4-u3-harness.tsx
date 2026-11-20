// 指派與我的場次截圖。只畫元件與假資料，不連 Firestore。
// ?screen= 與 ?theme=light|dark。畫完且錨點出現後設 window.__CPS_READY。
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import {
  ScorerMatchesScreen,
  StaffAssignScreen,
  StaffDeniedScreen,
  StaffListScreen,
  type AssignDayGroup,
} from '@/features/competitions/step4b/staff';
import { U3_COHOST_ROWS, U3_HOST_ROWS } from '@/features/competitions/testing/step4-u3-rows';
import { vsLabel } from '@/features/competitions/step4b/ui';
import {
  S4B_MATCHES,
  clockLabel,
  groupMatches,
  weekdayIndex,
} from '@/features/competitions/testing/step4b-fixtures';
import { weekdayName } from '@/features/competitions/step4b/copy';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'u3-staff-host';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

export const U3_SCREENS = [
  'u3-staff-host',
  'u3-staff-cohost',
  'u3-remove-confirm',
  'u3-assign',
  'u3-assign-error',
  'u3-my-matches',
  'u3-my-matches-empty',
  'u3-no-permission',
] as const;

const ANCHORS: Record<string, string> = {
  'u3-staff-host': '我自己',
  'u3-staff-cohost': '共同主辦',
  'u3-remove-confirm': '移除記分角色？',
  'u3-assign': '儲存',
  'u3-assign-error': '找不到這位成員',
  'u3-my-matches': '進入記分',
  'u3-my-matches-empty': '目前沒有被指派的場次',
  'u3-no-permission': '你沒有這場賽事的管理權限',
};

function dayText(month: number, day: number, weekday: number): string {
  return `${month}/${day}（${weekdayName[weekday] ?? ''}）`;
}

function assignDays(): AssignDayGroup[] {
  return groupMatches(S4B_MATCHES).map((group) => ({
    key: group.key,
    heading: dayText(group.month, group.day, weekdayIndex(group.key) ?? group.weekday),
    matches: group.matches.map((match) => {
      // 新外觀卡 4-D：場次拆三段（時間、場地、對戰），跨日的日期另放；整句仍是報讀名稱（同 StaffAssignPage 的 assignDays）。
      const clock = clockLabel(match.kickoffAt).time;
      const cut = clock.lastIndexOf(' ');
      return {
        id: match.id,
        label: `${clock} ${match.venue} ${vsLabel(match)}`,
        ...(cut > 0 ? { day: clock.slice(0, cut) } : {}),
        time: cut > 0 ? clock.slice(cut + 1) : clock,
        venue: match.venue,
        vs: vsLabel(match),
      };
    }),
  }));
}

const PEOPLE = [
  { id: 'me', name: '我自己' },
  { id: 's1', name: '成員 3' },
  { id: 's2', name: '成員 5' },
  { id: 'ref', name: '成員 6' },
];

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

function screenOf(name: string) {
  if (name === 'u3-staff-host') {
    return <StaffListScreen viewerRole="host" title="指派" rows={U3_HOST_ROWS} />;
  }
  if (name === 'u3-staff-cohost') {
    return <StaffListScreen viewerRole="coHost" title="指派" rows={U3_COHOST_ROWS} />;
  }
  if (name === 'u3-remove-confirm') {
    return (
      <StaffListScreen
        viewerRole="host"
        title="指派"
        rows={U3_HOST_ROWS}
        confirm={{
          title: '移除記分角色？',
          body: '這位成員將不能再記分。',
          confirmLabel: '移除',
          cancelLabel: '取消',
        }}
      />
    );
  }
  if (name === 'u3-assign' || name === 'u3-assign-error') {
    return (
      <StaffAssignScreen
        title="指派"
        people={PEOPLE}
        person="me"
        days={assignDays()}
        picked={new Set(['m_live'])}
        role="scorer"
        error={name === 'u3-assign-error' ? '找不到這位成員' : ''}
      />
    );
  }
  if (name === 'u3-my-matches') return <ScorerMatchesScreen title="我的場次" />;
  if (name === 'u3-my-matches-empty') {
    return <ScorerMatchesScreen title="我的場次" days={[]} empty="目前沒有被指派的場次" />;
  }
  return (
    <StaffDeniedScreen
      title="指派"
      message="你沒有這場賽事的管理權限"
      backLabel="回賽事頁"
      onBack={() => undefined}
    />
  );
}

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  await loadCompetitionsDict('zh-TW');
  const root = document.getElementById('app');
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  if (!root) return;
  try {
    if (!(U3_SCREENS as readonly string[]).includes(screenName)) {
      throw new Error(`沒有這個 screen：${screenName}`);
    }
    // 與正式 App 相同的內容容器（ui-app-shell 的 max-width）。U2 記分頁不走這支 harness。
    render(
      <LocationProvider>
        <div class="app-shell ui-app-shell">
          <main class="app-main">{screenOf(screenName)}</main>
        </div>
      </LocationProvider>,
      root,
    );
    const anchor = ANCHORS[screenName] ?? '';
    const startAt = Date.now();
    while (!hasText(anchor)) {
      if (Date.now() - startAt > 4000) throw new Error(`畫面未出現：${anchor}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}

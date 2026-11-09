// 課程 K1 截圖用元件 harness（只在本機 vite dev 開 /dev-harness/course-k1.html；正式 build 不含）。
// 資料全部是記憶體假資料（testing/fake-course-repo），不連 Firestore、不呼叫 Functions。
// 參數：?screen=tab|staff|empty|empty-staff|detail|lessons-weekly|lessons-session&theme=light|dark
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../features/clubs/legacy/team.css';
import '../features/clubs/legacy/team-detail-v2.css';
import { setLocale } from '@/i18n/i18n';
import type { Locale } from '@/i18n/locales';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import type { ViewerView } from '@/features/profile/data/viewer';
import { CourseTab } from '@/features/education/components/CourseTab';
import { CourseDetail } from '@/features/education/pages/CourseDetailPage';
import { CourseLessons } from '@/features/education/pages/CourseLessonsPage';
import { createFakeCourseRepo } from '@/features/education/testing/fake-course-repo';
import { COACH_UID, courseFixture, emptyCourseFixture, FIXTURE_NOW, PARENT_UID } from '@/features/education/testing/course-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'tab';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const locale = (params.get('lang') || 'zh-TW') as Locale;
document.documentElement.setAttribute('data-theme', theme);

const staff = screenName === 'staff' || screenName === 'empty-staff';
const uid = staff ? COACH_UID : PARENT_UID;
const data = screenName.startsWith('empty') ? emptyCourseFixture() : courseFixture();
const repo = createFakeCourseRepo(data, { uid, delayMs: 30 });
const now = () => FIXTURE_NOW;
const viewer = {
  uid,
  role: 'user',
  displayName: staff ? '林教練' : '王示範',
  hasPermission: () => false,
  teamIds: new Set<string>(),
  capabilities: [],
} as unknown as ViewerView;
const noop = () => undefined;

function ClubFrame() {
  const tabs = ['總覽', '課程', '活動', '成員'];
  return (
    <div class="legacy-ui">
      <section class="page active td-v2-active" id="page-team-detail">
        <div class="detail-body">
          <div class="td-v2-shell">
            <div class="td-v2-tab-rail">
              <div class="td-v2-tab-list" role="tablist">
                {tabs.map((label) => (
                  <button key={label} type="button" role="tab" class={label === '課程' ? 'active' : ''}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <main class="td-v2-content">
              <section class="td-v2-panel td-v2-panel-courses active" data-panel="courses">
                <CourseTab team={data.team} viewer={viewer} repo={repo} now={now} navigate={noop} />
              </section>
            </main>
          </div>
        </div>
      </section>
    </div>
  );
}

function Screen() {
  if (screenName === 'detail') {
    return <CourseDetail teamId="tm_demo" planId="p1" viewer={viewer} repo={repo} now={now} navigate={noop} onBack={noop} />;
  }
  if (screenName === 'lessons-weekly' || screenName === 'lessons-session') {
    const planId = screenName === 'lessons-weekly' ? 'p5' : 'p6';
    return <CourseLessons teamId="tm_demo" planId={planId} viewer={viewer} authUid={uid} repo={repo} now={now} onBack={noop} />;
  }
  return <ClubFrame />;
}

void setLocale(locale).then(() => {
  render(
    <LocationProvider>
      <Screen />
      <ToastHost />
      <AppConfirmHost />
    </LocationProvider>,
    document.getElementById('app')!,
  );
});

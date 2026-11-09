import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import type { ViewerView } from '@/features/profile/data/viewer';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { CourseDetail, countWeeklyDates } from './CourseDetailPage';
import { normalizePlan } from '../data/course-model';
import { createFakeCourseRepo, type FakeCourseRepo } from '../testing/fake-course-repo';
import { COACH_UID, courseFixture, FIXTURE_NOW, PARENT_UID } from '../testing/course-fixtures';

vi.mock('preact-iso', () => ({ useLocation: () => ({ route: vi.fn() }), useRoute: () => ({ params: {} }) }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn(async () => true) }));

let repo: FakeCourseRepo;
const viewer = (uid: string | null) => ({ uid, role: uid ? 'user' : 'guest', displayName: '王示範', hasPermission: () => false }) as unknown as ViewerView;

beforeAll(async () => {
  await setLocale('zh-TW');
});
beforeEach(() => {
  repo = createFakeCourseRepo(courseFixture(), { uid: PARENT_UID });
  vi.mocked(toast.show).mockReset();
  vi.mocked(appConfirm).mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

function renderDetail(planId: string, uid: string | null = PARENT_UID) {
  const navigate = vi.fn();
  const onLogin = vi.fn();
  const utils = render(
    <CourseDetail teamId="tm_demo" planId={planId} viewer={viewer(uid)} repo={repo} now={() => FIXTURE_NOW} navigate={navigate} onLogin={onLogin} />,
  );
  return { ...utils, navigate, onLogin };
}

function kv(container: Element): Array<[string, string]> {
  return Array.from(container.querySelectorAll('.ck-kv')).map((el) => [
    el.children[0]!.textContent ?? '',
    el.children[1]!.textContent ?? '',
  ]);
}

describe('課程詳情', () => {
  it('精簡欄位（時間、期間、地點、名額、費用、教練）；介紹收在「更多」；接下來 3 堂', async () => {
    const { container } = renderDetail('p1');
    await screen.findByText('週六兒童足球班');
    expect(screen.getByText('晨光足球學苑')).toBeTruthy();
    expect(kv(container)).toEqual([
      ['時間', '每週六 09:00–10:30'],
      ['期間', '11/1–12/27 · 共 8 堂'],
      ['地點', '北屯運動中心'],
      ['名額', '12/16 人'],
      ['費用', 'NT$3,200'],
      ['教練', '陳示範'],
    ]);
    expect(screen.queryByText(/6～12 歲/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.getByText(/6～12 歲/)).toBeTruthy();
    const upcoming = container.querySelector('[data-section="upcoming"]')!;
    expect(Array.from(upcoming.querySelectorAll('.ck-line')).map((el) => el.textContent)).toEqual([
      '第 3 堂11/14（六）09:00',
      '第 4 堂11/21（六）09:00',
      '第 5 堂11/28（六）09:00',
    ]);
  });

  it('報名開「幫誰報名？」；未登入改請登入', async () => {
    const a = renderDetail('p1');
    await screen.findByText('週六兒童足球班');
    fireEvent.click(screen.getByRole('button', { name: '報名' }));
    expect(await screen.findByRole('radiogroup', { name: '幫誰報名？' })).toBeTruthy();
    a.unmount();
    repo.calls.length = 0;
    const b = renderDetail('p1', null);
    await screen.findByText('週六兒童足球班');
    expect(within(b.container as HTMLElement).getByText('16 人')).toBeTruthy();
    fireEvent.click(within(b.container as HTMLElement).getByRole('button', { name: '報名' }));
    expect(b.onLogin).toHaveBeenCalled();
    expect(repo.calls.some((c) => c.method === 'listSummaries')).toBe(false);
  });

  it('一個孩子已報名、另一位審核中：課堂＋取消申請＋（仍可報名其他人）報名', async () => {
    const { container, navigate } = renderDetail('p5');
    await screen.findByText('週日親子班');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.ck-btn-row button')).map((b) => b.dataset.action);
    expect(buttons).toEqual(['lessons', 'cancel-pending', 'signup']);
    fireEvent.click(screen.getByRole('button', { name: '課堂' }));
    expect(navigate).toHaveBeenCalledWith('/courses/tm_demo/p5/lessons');
    fireEvent.click(screen.getByRole('button', { name: '取消申請' }));
    await waitFor(() => expect(repo.calls.find((c) => c.method === 'cancelPending')?.args).toEqual(['tm_demo', 'p5', ['stu_qing']]));
  });

  it('額滿與已截止只有停用鈕；幹部多一顆管理', async () => {
    const a = renderDetail('p3');
    await screen.findByText('週三體能班');
    expect((screen.getByRole('button', { name: '額滿' }) as HTMLButtonElement).disabled).toBe(true);
    a.unmount();
    const b = renderDetail('p4');
    await screen.findByText('秋季幼兒班');
    expect((screen.getByRole('button', { name: '已截止' }) as HTMLButtonElement).disabled).toBe(true);
    b.unmount();
    const c = renderDetail('p1', COACH_UID);
    await screen.findByText('週六兒童足球班');
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    expect(c.navigate).toHaveBeenCalledWith('/course-manage/tm_demo/p1');
  });

  it('找不到或未公開的方案顯示「找不到課程」', async () => {
    renderDetail('nope');
    expect(await screen.findByText('找不到課程')).toBeTruthy();
  });

  it('固定週期總堂數＝起訖日之間的上課日數（同 A generateWeeklyDates，缺起訖為 0）', () => {
    expect(countWeeklyDates(normalizePlan('x', { planType: 'weekly', weekdays: [6], startDate: '2026-11-01', endDate: '2026-12-27' }))).toBe(8);
    expect(countWeeklyDates(normalizePlan('x', { planType: 'weekly', weekdays: [2, 4], startDate: '2026-11-01', endDate: '2026-11-14' }))).toBe(4);
    expect(countWeeklyDates(normalizePlan('x', { planType: 'weekly', weekdays: [6], startDate: '', endDate: '2026-12-27' }))).toBe(0);
  });
});

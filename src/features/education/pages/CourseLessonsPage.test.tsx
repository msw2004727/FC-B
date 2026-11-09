import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import type { ViewerView } from '@/features/profile/data/viewer';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { CourseLessons } from './CourseLessonsPage';
import { callableError, createFakeCourseRepo, type FakeCourseRepo } from '../testing/fake-course-repo';
import { courseFixture, FIXTURE_NOW, PARENT_UID } from '../testing/course-fixtures';

vi.mock('preact-iso', () => ({ useLocation: () => ({ route: vi.fn() }), useRoute: () => ({ params: {} }) }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn(async () => true) }));

let repo: FakeCourseRepo;
const login = vi.fn();
const viewer = (uid: string | null) => ({ uid, role: 'user', displayName: '王示範', hasPermission: () => false }) as unknown as ViewerView;

beforeAll(async () => {
  await setLocale('zh-TW');
});
beforeEach(() => {
  repo = createFakeCourseRepo(courseFixture(), { uid: PARENT_UID });
  vi.mocked(toast.show).mockReset();
  vi.mocked(appConfirm).mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

function renderLessons(planId: string, uid: string | null = PARENT_UID, authUid?: string | null) {
  return render(
    <CourseLessons teamId="tm_demo" planId={planId} viewer={viewer(uid)} authUid={authUid} repo={repo} now={() => FIXTURE_NOW} onLogin={login} />,
  );
}

function row(container: Element, sessionId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-session-id="${sessionId}"]`);
  if (!el) throw new Error(`no row ${sessionId}`);
  return el;
}

describe('課堂列表：固定週期（單堂報名、請假）', () => {
  it('名冊有我的課堂才列出；沒紀錄顯示「未報名」（統計照 A 不動）；已上過的不給按鈕', async () => {
    const { container } = renderLessons('p5');
    await screen.findByText('週日親子班');
    await waitFor(() => expect(container.querySelectorAll('[data-session-id]').length).toBe(5));
    const display = Array.from(container.querySelectorAll<HTMLElement>('[data-session-id]')).map((el) => [
      el.dataset.sessionId,
      el.dataset.display,
      el.querySelector('button')?.textContent ?? null,
    ]);
    expect(display).toEqual([
      ['p5s1', 'signin', null],
      ['p5s2', 'unregistered', null],
      ['p5s3', 'registered', '請假'],
      ['p5s4', 'unregistered', '報名'],
      ['p5s5', 'leave', '取消'],
    ]);
    expect(within(row(container, 'p5s2')).getByText('未報名')).toBeTruthy();
    // 只有一位學員在名冊：不出切換列。
    expect(container.querySelector('.ck-seg')).toBeNull();
  });

  it('報名＝saveEduCourseSelfAttendance(registered)；請假＝確認後 saveEduCourseSelfAttendance(leave)；取消＝saveEduCourseSelfLeave(false)', async () => {
    const { container } = renderLessons('p5');
    await waitFor(() => expect(container.querySelector('[data-session-id="p5s4"] button')).toBeTruthy());
    fireEvent.click(within(row(container, 'p5s4')).getByRole('button', { name: '報名' }));
    await waitFor(() => expect(row(container, 'p5s4').dataset.display).toBe('registered'));
    fireEvent.click(within(row(container, 'p5s3')).getByRole('button', { name: '請假' }));
    await waitFor(() => expect(row(container, 'p5s3').dataset.display).toBe('leave'));
    expect(appConfirm).toHaveBeenCalledWith('第 3 堂請假？（陳小安）', { okText: '請假' });
    fireEvent.click(within(row(container, 'p5s5')).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(row(container, 'p5s5').dataset.display).toBe('unregistered'));
    const writes = repo.calls.filter((c) => c.method === 'saveSelfAttendance' || c.method === 'saveSelfLeave').map((c) => [c.method, ...c.args]);
    expect(writes).toEqual([
      ['saveSelfAttendance', 'p5', 'p5s4', 'stu_an', 'registered'],
      ['saveSelfAttendance', 'p5', 'p5s3', 'stu_an', 'leave'],
      ['saveSelfLeave', 'p5', 'p5s5', 'stu_an', false],
    ]);
  });

  it('請假確認按返回就不送出', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    const { container } = renderLessons('p5');
    await waitFor(() => expect(container.querySelector('[data-session-id="p5s3"] button')).toBeTruthy());
    fireEvent.click(within(row(container, 'p5s3')).getByRole('button', { name: '請假' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    expect(repo.calls.some((c) => c.method === 'saveSelfAttendance')).toBe(false);
  });

  it('錯誤碼轉中文（不在名單、這堂已關閉）', async () => {
    const { container } = renderLessons('p5');
    await waitFor(() => expect(container.querySelector('[data-session-id="p5s4"] button')).toBeTruthy());
    repo.failNext('saveSelfAttendance', callableError('STUDENT_NOT_IN_ROSTER'));
    fireEvent.click(within(row(container, 'p5s4')).getByRole('button', { name: '報名' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '不在這堂的名單', tone: 'error' }));
    repo.failNext('saveSelfAttendance', callableError('SELF_ATTENDANCE_SESSION_CLOSED'));
    fireEvent.click(within(row(container, 'p5s4')).getByRole('button', { name: '報名' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '這堂已關閉', tone: 'error' }));
  });
});

describe('課堂列表：出缺席讀取失敗（審查 P3-3）', () => {
  it('讀不到出缺席時顯示錯誤與重試，沒有課堂列也不顯示「未報名」；重試後恢復', async () => {
    repo.failNext('listMyAttendance', new Error('offline'));
    const { container } = renderLessons('p5');
    const retry = await screen.findByRole('button', { name: '重新嘗試' });
    expect(container.querySelector('[data-session-id]')).toBeNull();
    expect(screen.queryByText('未報名')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(container.querySelectorAll('[data-session-id]').length).toBe(5));
    expect(row(container, 'p5s4').dataset.display).toBe('unregistered');
  });
});

describe('課堂列表：堂數制（請假）與多位學員', () => {
  it('兩位孩子都在名冊時出切換；請假＝saveEduCourseSelfLeave(true)，取消＝(false)', async () => {
    const { container } = renderLessons('p6');
    await screen.findByText('守門員進階');
    const seg = container.querySelector('.ck-seg')!;
    expect(Array.from(seg.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['陳小安', '陳小晴']);
    await waitFor(() => expect(container.querySelectorAll('[data-session-id]').length).toBe(4));
    expect(Array.from(container.querySelectorAll<HTMLElement>('[data-session-id]')).map((el) => [el.dataset.display, el.querySelector('button')?.textContent ?? null])).toEqual([
      ['signin', null],
      ['leave', null],
      ['none', '請假'],
      ['leave', '取消'],
    ]);
    fireEvent.click(within(row(container, 'p6s3')).getByRole('button', { name: '請假' }));
    await waitFor(() => expect(row(container, 'p6s3').dataset.display).toBe('leave'));
    fireEvent.click(within(row(container, 'p6s4')).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(row(container, 'p6s4').dataset.display).toBe('none'));
    expect(repo.calls.filter((c) => c.method === 'saveSelfLeave').map((c) => c.args)).toEqual([
      ['p6', 'p6s3', 'stu_an', true],
      ['p6', 'p6s4', 'stu_an', false],
    ]);
    // 小晴不在第 4 堂名冊（sessions.studentIds）→ 只列 3 堂。
    fireEvent.click(within(seg as HTMLElement).getByRole('button', { name: '陳小晴' }));
    await waitFor(() => expect(container.querySelectorAll('[data-session-id]').length).toBe(3));
  });
});

describe('課堂列表：登入狀態（L-43）', () => {
  it('登入狀態未定：載入中、不讀資料；確定未登入才請登入', async () => {
    const a = renderLessons('p5', null, undefined);
    expect(await screen.findByText('載入中…')).toBeTruthy();
    expect(repo.calls).toEqual([]);
    a.unmount();
    renderLessons('p5', null, null);
    fireEvent.click(await screen.findByRole('button', { name: '登入' }));
    expect(login).toHaveBeenCalled();
    expect(repo.calls).toEqual([]);
  });
});

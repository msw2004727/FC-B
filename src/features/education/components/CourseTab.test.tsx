import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import type { ViewerView } from '@/features/profile/data/viewer';
import { toast } from '@/ui/Toast';
import { appConfirm } from '@/ui/AppConfirm';
import { CourseTab } from './CourseTab';
import { callableError, createFakeCourseRepo, type FakeCourseRepo } from '../testing/fake-course-repo';
import { COACH_UID, courseFixture, emptyCourseFixture, FIXTURE_NOW, PARENT_UID } from '../testing/course-fixtures';

const route = vi.hoisted(() => vi.fn());
vi.mock('preact-iso', () => ({ useLocation: () => ({ route }), useRoute: () => ({ params: {} }) }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn(async () => true) }));

function viewer(uid: string | null, extra: Partial<ViewerView> = {}): ViewerView {
  return {
    uid,
    role: uid ? 'user' : 'guest',
    displayName: uid ? '王示範' : null,
    hasPermission: () => false,
    teamIds: new Set<string>(),
    capabilities: [],
    roleLevel: 0,
    pictureUrl: null,
    ...extra,
  } as unknown as ViewerView;
}

let repo: FakeCourseRepo;
const now = () => FIXTURE_NOW;

function renderTab(v = viewer(PARENT_UID), r: FakeCourseRepo = repo) {
  const navigate = vi.fn();
  const utils = render(<CourseTab team={r.data.team} viewer={v} repo={r} now={now} navigate={navigate} />);
  return { ...utils, navigate };
}

function card(container: Element, planId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.ck-card[data-plan-id="${planId}"]`);
  if (!el) throw new Error(`no card ${planId}`);
  return el;
}

beforeAll(async () => {
  await setLocale('zh-TW');
});
beforeEach(() => {
  repo = createFakeCourseRepo(courseFixture(), { uid: PARENT_UID });
  route.mockReset();
  vi.mocked(toast.show).mockReset();
  vi.mocked(appConfirm).mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

describe('CourseTab：課程卡 6 種狀態', () => {
  it('可報名（固定週期／堂數制）、額滿、已截止、審核中、已報名；已結束方案不出現', async () => {
    const { container } = renderTab();
    await screen.findByText('週六兒童足球班');
    const states = Array.from(container.querySelectorAll<HTMLElement>('.ck-card[data-plan-id]')).map((el) => [el.dataset.planId, el.dataset.state]);
    expect(states).toEqual([
      ['p1', 'open'],
      ['p2', 'open'],
      ['p3', 'full'],
      ['p4', 'closed'],
      ['p5', 'pending'],
      ['p6', 'enrolled'],
    ]);
    expect(screen.queryByText('春季班')).toBeNull();

    // 固定週期：時間列、類型、人數用伺服器 effectiveApprovedCount。
    const p1 = within(card(container, 'p1'));
    expect(p1.getByText('每週六 09:00–10:30')).toBeTruthy();
    expect(p1.getByText('固定週期')).toBeTruthy();
    expect(p1.getByText('12/16 人')).toBeTruthy();
    expect(p1.getByText('NT$3,200')).toBeTruthy();
    expect(p1.getByRole('button', { name: '報名' })).toBeTruthy();
    // 堂數制：「N 堂」與第一堂起始。
    const p2 = within(card(container, 'p2'));
    expect(p2.getByText('8 堂')).toBeTruthy();
    expect(p2.getByText('12/6 起 · 日 14:00–16:00')).toBeTruthy();
    // 額滿：紅字人數＋停用鈕。
    const p3 = card(container, 'p3');
    expect(p3.querySelector('.ck-cnt-full')?.textContent).toBe('16/16 人');
    expect((within(p3).getByRole('button', { name: '額滿' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card(container, 'p4')).getByRole('button', { name: '已截止' }) as HTMLButtonElement).disabled).toBe(true);
    // 審核中：分組舊制學員（小安）＋另一位 pending（小晴）→ 照 A 顯示審核中與取消申請。
    const p5 = within(card(container, 'p5'));
    expect(p5.getByText('審核中')).toBeTruthy();
    expect(p5.getByRole('button', { name: '取消申請' })).toBeTruthy();
    // 分組舊制的小安算進人數（6 筆 approved ＋ 1 位分組 active）。
    expect(p5.getByText('7/12 人')).toBeTruthy();
    const p6 = within(card(container, 'p6'));
    expect(p6.getByText('已報名')).toBeTruthy();
    expect(p6.getByRole('button', { name: '課堂' })).toBeTruthy();
  });

  it('已報名（已核准）不給學員取消，只顯示一行「請聯繫教練取消」；其他狀態與幹部不顯示（顧問 §3.60 c）', async () => {
    const { container } = renderTab();
    await screen.findByText('守門員進階', { selector: '.ck-card[data-plan-id] b' });
    const p6 = card(container, 'p6');
    expect(within(p6).getByText('請聯繫教練取消')).toBeTruthy();
    expect(within(p6).queryByRole('button', { name: /取消/ })).toBeNull();
    expect(container.querySelectorAll('.ck-card[data-plan-id] [data-hint="contact-coach"]')).toHaveLength(1);
    cleanup();
    const staff = renderTab(viewer(COACH_UID));
    await screen.findByText('週六兒童足球班');
    expect(staff.container.querySelector('[data-hint="contact-coach"]')).toBeNull();
  });

  it('只讀有關的方案的報名（viewerStatuses 有我的學員才讀）', async () => {
    renderTab();
    await screen.findByText('週六兒童足球班');
    const planIds = repo.calls.filter((c) => c.method === 'listMyEnrollments').map((c) => c.args[1]);
    expect(planIds.sort()).toEqual(['p5', 'p6']);
  });

  it('幹部：每張卡「管理」（待審數字）、上方「開課」；連到 K2／K3 入口', async () => {
    const { container, navigate } = renderTab(viewer(COACH_UID));
    await screen.findByText('週六兒童足球班');
    expect(container.querySelectorAll('[data-action="manage"]').length).toBe(6);
    expect(card(container, 'p5').querySelector('[data-action="manage"] .ck-badge')?.textContent).toBe('1');
    expect(card(container, 'p1').querySelector('[data-action="manage"] .ck-badge')).toBeNull();
    fireEvent.click(within(card(container, 'p1')).getByRole('button', { name: '管理' }));
    expect(navigate).toHaveBeenCalledWith('/course-manage/tm_demo/p1');
    fireEvent.click(container.querySelector('.ck-ghost[data-action="create"]')!);
    expect(navigate).toHaveBeenCalledWith('/course-manage/tm_demo');
  });

  it('空狀態：學員只看到「還沒有課程」，幹部多一顆開課', async () => {
    const empty = createFakeCourseRepo(emptyCourseFixture(), { uid: PARENT_UID });
    const a = renderTab(viewer(PARENT_UID), empty);
    await screen.findByText('還沒有課程');
    expect(a.container.querySelector('[data-action="create"]')).toBeNull();
    a.unmount();
    const b = renderTab(viewer(COACH_UID), empty);
    await screen.findByText('還沒有課程');
    expect(b.container.querySelectorAll('[data-action="create"]').length).toBe(1);
  });

  it('點卡片進詳情、已報名按課堂進課堂列表', async () => {
    const { container, navigate } = renderTab();
    await screen.findByText('週六兒童足球班');
    fireEvent.click(card(container, 'p1'));
    expect(navigate).toHaveBeenLastCalledWith('/courses/tm_demo/p1');
    fireEvent.click(within(card(container, 'p6')).getByRole('button', { name: '課堂' }));
    expect(navigate).toHaveBeenLastCalledWith('/courses/tm_demo/p6/lessons');
  });

  it('讀取失敗顯示重試，重試後恢復', async () => {
    repo.failNext('listPlans', new Error('offline'));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: '重新嘗試' }));
    expect(await screen.findByText('週六兒童足球班')).toBeTruthy();
  });
});

describe('CourseTab：報名、取消申請與錯誤碼', () => {
  it('報名：開「幫誰報名？」，自己還沒有學員資料時先建 pending 本人學員再呼叫 registerForEduCoursePlan', async () => {
    const solo = createFakeCourseRepo({ ...courseFixture(), students: [] }, { uid: 'u_solo' });
    const { container } = renderTab(viewer('u_solo'), solo);
    await screen.findByText('週六兒童足球班');
    fireEvent.click(within(card(container, 'p1')).getByRole('button', { name: '報名' }));
    const sheet = await screen.findByRole('radiogroup', { name: '幫誰報名？' });
    expect(within(sheet).getByRole('radio', { name: '自己（王示範）' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(sheet).getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(solo.calls.some((c) => c.method === 'register')).toBe(true));
    const created = solo.calls.find((c) => c.method === 'createPendingStudent');
    expect(created?.args[1]).toEqual({ name: '王示範', uid: 'u_solo', relation: 'self' });
    const reg = solo.calls.find((c) => c.method === 'register');
    expect(reg?.args).toEqual(['tm_demo', 'p1', [solo.data.students[0]!.id]]);
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ message: '已送出，等教練核准' })));
    // 送出後重讀：卡片變成審核中。
    await waitFor(() => expect(card(container, 'p1').dataset.state).toBe('pending'));
  });

  it.each([
    ['COURSE_FULL', '名額已滿'],
    ['SIGNUP_CLOSED', '報名已截止'],
    ['PLAN_ENDED', '課程已結束'],
    ['STUDENT_INACTIVE', '學員已停用'],
  ])('錯誤碼 %s 轉成中文「%s」', async (code, text) => {
    const { container } = renderTab();
    await screen.findByText('週六兒童足球班');
    repo.failNext('register', callableError(code));
    fireEvent.click(within(card(container, 'p1')).getByRole('button', { name: '報名' }));
    const sheet = await screen.findByRole('radiogroup', { name: '幫誰報名？' });
    fireEvent.click(within(sheet).getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ message: text, tone: 'error' })));
  });

  it('ALREADY_ENROLLED：提示已報名過並重讀，不當成錯誤', async () => {
    const { container } = renderTab();
    await screen.findByText('週六兒童足球班');
    repo.failNext('register', Object.assign(new Error('ALREADY_ENROLLED'), { code: 'functions/already-exists', details: { code: 'ALREADY_ENROLLED' } }));
    fireEvent.click(within(card(container, 'p1')).getByRole('button', { name: '報名' }));
    const sheet = await screen.findByRole('radiogroup', { name: '幫誰報名？' });
    fireEvent.click(within(sheet).getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '已報名過' }));
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull());
  });

  it('取消申請：確認後只取消審核中的學員（cancelCourseEnrollment），卡片回到可報名', async () => {
    const { container } = renderTab();
    await screen.findAllByText('週日親子班');
    fireEvent.click(within(card(container, 'p5')).getByRole('button', { name: '取消申請' }));
    await waitFor(() => expect(repo.calls.some((c) => c.method === 'cancelPending')).toBe(true));
    expect(appConfirm).toHaveBeenCalledWith('取消 陳小晴 的申請？', expect.objectContaining({ okText: '取消申請' }));
    expect(repo.calls.find((c) => c.method === 'cancelPending')?.args).toEqual(['tm_demo', 'p5', ['stu_qing']]);
    // 小安仍靠分組在名冊內 → 已報名。
    await waitFor(() => expect(card(container, 'p5').dataset.state).toBe('enrolled'));
  });

  it('取消申請按「保留」不呼叫 Callable', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    const { container } = renderTab();
    await screen.findAllByText('週日親子班');
    fireEvent.click(within(card(container, 'p5')).getByRole('button', { name: '取消申請' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    expect(repo.calls.some((c) => c.method === 'cancelPending')).toBe(false);
  });
});

describe('CourseTab：我的課程（聯集、出席數、未繳費）', () => {
  it('列出聯集內與審核中的學員；出席數只算名冊（sessions.studentIds）內已上過的課；分組舊制與未付款標未繳費', async () => {
    const { container, navigate } = renderTab();
    await screen.findByText('我的課程');
    const mine = container.querySelector('[data-section="my-courses"]')!;
    const keys = Array.from(mine.querySelectorAll<HTMLElement>('[data-my-course]')).map((el) => el.dataset.myCourse);
    expect(keys).toEqual(['p5:stu_an', 'p5:stu_qing', 'p6:stu_an', 'p6:stu_qing']);
    const an6 = mine.querySelector<HTMLElement>('[data-my-course="p6:stu_an"]')!;
    await waitFor(() => expect(within(an6).getByText('出席 1/2 堂')).toBeTruthy());
    expect(within(an6).getByText('下一堂 11/16（一）14:00')).toBeTruthy();
    expect(within(an6).queryByText('未繳費')).toBeNull();
    const qing6 = mine.querySelector<HTMLElement>('[data-my-course="p6:stu_qing"]')!;
    expect(within(qing6).getByText('未繳費')).toBeTruthy();
    const an5 = mine.querySelector<HTMLElement>('[data-my-course="p5:stu_an"]')!;
    expect(within(an5).getByText('未繳費')).toBeTruthy();
    const qing5 = mine.querySelector<HTMLElement>('[data-my-course="p5:stu_qing"]')!;
    expect(within(qing5).getByText('審核中')).toBeTruthy();
    fireEvent.click(an6);
    expect(navigate).toHaveBeenLastCalledWith('/courses/tm_demo/p6/lessons');
    fireEvent.click(qing5);
    expect(navigate).toHaveBeenLastCalledWith('/courses/tm_demo/p5');
    // 同一方案兩個孩子共用一次課堂讀取。
    expect(repo.calls.filter((c) => c.method === 'listSessions' && c.args[1] === 'p6')).toHaveLength(1);
  });
});

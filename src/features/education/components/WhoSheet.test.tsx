import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { WhoSheet } from './WhoSheet';
import { loadCourseDict, makeCourseT, type CourseT } from '../i18n';
import { getViewerPlanState, normalizePlan, normalizeStudent, type CourseStudent } from '../data/course-model';
import { toCourseTeam } from '../data/course-repo';
import { createFakeCourseRepo, type FakeCourseRepo } from '../testing/fake-course-repo';
import { courseFixture, PARENT_UID } from '../testing/course-fixtures';

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));

let ct: CourseT;
let repo: FakeCourseRepo;

beforeAll(async () => {
  await setLocale('zh-TW');
  ct = makeCourseT(await loadCourseDict('zh-TW'));
});
beforeEach(() => {
  repo = createFakeCourseRepo(courseFixture(), { uid: PARENT_UID });
  vi.mocked(toast.show).mockReset();
});
afterEach(() => cleanup());

function mine(): CourseStudent[] {
  return repo.data.students.filter((s) => s.parentUid === PARENT_UID).map((s) => normalizeStudent(s.id, s));
}

function renderSheet(planId: string, students = mine()) {
  const plan = normalizePlan(planId, repo.data.plans[planId]!);
  const state = getViewerPlanState(plan, students, repo.data.enrollments[planId] ?? [], false);
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <WhoSheet
      ct={ct}
      repo={repo}
      team={toCourseTeam(repo.data.team)}
      plan={plan}
      uid={PARENT_UID}
      displayName="王示範"
      myStudents={students}
      state={state}
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
  return { onClose, onChanged, sheet: screen.getByRole('radiogroup', { name: '幫誰報名？' }) };
}

describe('WhoSheet：家長代報', () => {
  it('列出自己與孩子；已報名、審核中不能再選；有孩子時不預設任何人、送出鈕停用（審查 P2-1）', () => {
    const { sheet } = renderSheet('p5');
    const radios = within(sheet).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['自己（王示範）', '陳小安已報名', '陳小晴審核中']);
    expect((radios[1] as HTMLButtonElement).disabled).toBe(true);
    expect((radios[2] as HTMLButtonElement).disabled).toBe(true);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    expect((within(sheet).getByRole('button', { name: '送出報名' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('有孩子、沒有本人資料：不會一鍵替家長建本人學員；明確點「自己」才建', async () => {
    const { sheet } = renderSheet('p1');
    const submit = within(sheet).getByRole('button', { name: '送出報名' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(repo.calls).toEqual([]);
    fireEvent.click(within(sheet).getByRole('radio', { name: '自己（王示範）' }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(repo.calls.some((c) => c.method === 'register')).toBe(true));
    expect(repo.calls.find((c) => c.method === 'createPendingStudent')?.args[1]).toEqual({ name: '王示範', uid: PARENT_UID, relation: 'self' });
  });

  it('名下完全沒有學員時照 A 預設「自己」', () => {
    const { sheet } = renderSheet('p1', []);
    expect(within(sheet).getByRole('radio', { name: '自己（王示範）' }).getAttribute('aria-checked')).toBe('true');
    expect((within(sheet).getByRole('button', { name: '送出報名' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('選孩子送出：registerForEduCoursePlan 帶那位孩子', async () => {
    const { sheet, onChanged, onClose } = renderSheet('p1');
    fireEvent.click(within(sheet).getByRole('radio', { name: '陳小晴' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(repo.calls.find((c) => c.method === 'register')?.args).toEqual(['tm_demo', 'p1', ['stu_qing']]);
    expect(repo.calls.some((c) => c.method === 'createPendingStudent')).toBe(false);
    expect(onChanged).toHaveBeenCalled();
  });

  it('第一次代報的家長：新增孩子寫一筆 pending 學員（parent）、顯示「待核准」並可直接報名', async () => {
    const { sheet } = renderSheet('p1', []);
    expect(within(sheet).getAllByRole('radio').map((r) => r.textContent)).toEqual(['自己（王示範）']);
    fireEvent.click(within(sheet).getByRole('button', { name: '新增孩子' }));
    const input = within(sheet).getByRole('textbox', { name: '孩子姓名' });
    fireEvent.input(input, { target: { value: '陳小樂' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '新增' }));
    const added = await within(sheet).findByRole('radio', { name: '陳小樂待核准' });
    expect(added.getAttribute('aria-checked')).toBe('true');
    expect(repo.calls.find((c) => c.method === 'createPendingStudent')?.args[1]).toEqual({ name: '陳小樂', uid: PARENT_UID, relation: 'parent' });
    const created = repo.data.students.at(-1)!;
    expect(created).toMatchObject({ parentUid: PARENT_UID, selfUid: null, enrollStatus: 'pending', name: '陳小樂' });
    fireEvent.click(within(sheet).getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(repo.calls.some((c) => c.method === 'register')).toBe(true));
    expect(repo.calls.find((c) => c.method === 'register')?.args[2]).toEqual([created.id]);
  });

  it('沒有 LINE 名稱：建本人前要先填姓名，空白時明確提示而不是「操作失敗」（審查 P3-1）', async () => {
    const plan = normalizePlan('p1', repo.data.plans.p1!);
    const state = getViewerPlanState(plan, [], [], false);
    render(
      <WhoSheet ct={ct} repo={repo} team={toCourseTeam(repo.data.team)} plan={plan} uid={PARENT_UID} displayName="  "
        myStudents={[]} state={state} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    const sheet = screen.getByRole('radiogroup', { name: '幫誰報名？' });
    expect(within(sheet).getByRole('radio', { name: '自己' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(sheet).getByRole('button', { name: '送出報名' }));
    expect(toast.show).toHaveBeenLastCalledWith(expect.objectContaining({ message: '請輸入姓名' }));
    expect(repo.calls).toEqual([]);
    fireEvent.input(within(sheet).getByRole('textbox', { name: '你的姓名' }), { target: { value: '林小明' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '送出報名' }));
    await waitFor(() => expect(repo.calls.some((c) => c.method === 'register')).toBe(true));
    expect(repo.calls.find((c) => c.method === 'createPendingStudent')?.args[1]).toEqual({ name: '林小明', uid: PARENT_UID, relation: 'self' });
  });

  it('本人學員已退學（inactive）：「自己」顯示已停用、不能選，也不會再建一筆本人學員', () => {
    const plan = normalizePlan('p1', repo.data.plans.p1!);
    const inactiveSelf = normalizeStudent('stu_old', { name: '王示範', selfUid: PARENT_UID, enrollStatus: 'inactive' });
    const state = getViewerPlanState(plan, [], [], false);
    render(
      <WhoSheet ct={ct} repo={repo} team={toCourseTeam(repo.data.team)} plan={plan} uid={PARENT_UID} displayName="王示範"
        myStudents={[]} inactiveSelf={inactiveSelf} state={state} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    const sheet = screen.getByRole('radiogroup', { name: '幫誰報名？' });
    const self = within(sheet).getByRole('radio', { name: '自己（王示範）已停用' }) as HTMLButtonElement;
    expect(self.disabled).toBe(true);
    expect(self.getAttribute('aria-checked')).toBe('false');
    expect((within(sheet).getByRole('button', { name: '送出報名' }) as HTMLButtonElement).disabled).toBe(true);
    expect(repo.calls).toEqual([]);
  });

  it('新增孩子連點兩下只建一筆（同步鎖，審查 P3-10）', async () => {
    const { sheet } = renderSheet('p1');
    fireEvent.click(within(sheet).getByRole('button', { name: '新增孩子' }));
    fireEvent.input(within(sheet).getByRole('textbox', { name: '孩子姓名' }), { target: { value: '陳小樂' } });
    const add = within(sheet).getByRole('button', { name: '新增' });
    fireEvent.click(add);
    fireEvent.click(add);
    await within(sheet).findByRole('radio', { name: '陳小樂待核准' });
    expect(repo.calls.filter((c) => c.method === 'createPendingStudent')).toHaveLength(1);
  });

  it('新增孩子：沒填姓名或同名重複不建立', async () => {
    const { sheet } = renderSheet('p1');
    fireEvent.click(within(sheet).getByRole('button', { name: '新增孩子' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '新增' }));
    expect(toast.show).toHaveBeenLastCalledWith(expect.objectContaining({ message: '請輸入姓名' }));
    fireEvent.input(within(sheet).getByRole('textbox', { name: '孩子姓名' }), { target: { value: '陳小安' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '新增' }));
    expect(toast.show).toHaveBeenLastCalledWith(expect.objectContaining({ message: '「陳小安」已經新增過' }));
    expect(repo.calls.some((c) => c.method === 'createPendingStudent')).toBe(false);
  });
});

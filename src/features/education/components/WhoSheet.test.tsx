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
  it('列出自己與孩子；已報名、審核中不能再選', () => {
    const { sheet } = renderSheet('p5');
    const radios = within(sheet).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['自己（王示範）', '陳小安已報名', '陳小晴審核中']);
    expect((radios[1] as HTMLButtonElement).disabled).toBe(true);
    expect((radios[2] as HTMLButtonElement).disabled).toBe(true);
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
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

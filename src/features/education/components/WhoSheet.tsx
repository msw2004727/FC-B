// 「幫誰報名？」底部選單（K1-2）：自己＋名下孩子；第一次代報的家長可在這裡「新增孩子」（P1-3）。
// 新增孩子＝照 A edu-student-join 寫一筆 pending 學員（Rules 允許），立刻可選，Sheet 上標「待核准」。
// 報名一律走 registerForEduCoursePlan；已報名由伺服器判斷（ALREADY_ENROLLED）。
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { BottomSheet } from '@/ui/BottomSheet';
import { toast } from '@/ui/Toast';
import type { CourseT } from '../i18n';
import { courseErrorCode, type CoursePlan, type CourseStudent, type ViewerPlanState } from '../data/course-model';
import type { CourseRepo, CourseTeam } from '../data/course-repo';
import { IconPlus } from './icons';

const SELF_NEW = '__self_new__';

export interface WhoSheetProps {
  ct: CourseT;
  repo: CourseRepo;
  team: CourseTeam;
  plan: CoursePlan;
  uid: string;
  displayName: string;
  myStudents: readonly CourseStudent[];
  state: ViewerPlanState;
  onClose: () => void;
  /** 報名送出或名下學員有變（新增孩子）後重讀。 */
  onChanged: () => void;
}

interface Option {
  key: string;
  label: string;
  student: CourseStudent | null;
  chip: 'enrolled' | 'pending' | 'studentPending' | null;
  disabled: boolean;
}

export function buildWhoOptions(
  ct: CourseT,
  uid: string,
  displayName: string,
  students: readonly CourseStudent[],
  state: ViewerPlanState,
): Option[] {
  const self = students.find((s) => s.selfUid === uid) ?? null;
  const children = students.filter((s) => s !== self && s.parentUid === uid);
  const chipOf = (s: CourseStudent): Option['chip'] => {
    if (state.approvedIds.has(s.id)) return 'enrolled';
    if (state.pendingIds.has(s.id)) return 'pending';
    if (s.enrollStatus === 'pending') return 'studentPending';
    return null;
  };
  const toOption = (s: CourseStudent, label: string): Option => {
    const chip = chipOf(s);
    return { key: s.id, label, student: s, chip, disabled: chip === 'enrolled' || chip === 'pending' };
  };
  const selfName = (self?.name || displayName).trim();
  const selfLabel = selfName ? ct('sheet.self', { name: selfName }) : ct('sheet.selfBare');
  const options: Option[] = [
    self ? toOption(self, selfLabel) : { key: SELF_NEW, label: selfLabel, student: null, chip: null, disabled: false },
  ];
  for (const child of children) options.push(toOption(child, child.name));
  return options;
}

export function WhoSheet({
  ct,
  repo,
  team,
  plan,
  uid,
  displayName,
  myStudents,
  state,
  onClose,
  onChanged,
}: WhoSheetProps): JSX.Element {
  const [students, setStudents] = useState<CourseStudent[]>(() => [...myStudents]);
  const options = useMemo(
    () => buildWhoOptions(ct, uid, displayName, students, state),
    [ct, uid, displayName, students, state],
  );
  // 審查 P2-1：只有名下完全沒有學員時才預設「自己」（照 A：沒有學員才自動建本人）；
  // 有孩子或本人資料時不預設，要明確點選才能送出，避免家長一鍵把自己報進去。
  const [picked, setPicked] = useState<string | null>(() => (myStudents.length === 0 ? SELF_NEW : null));
  const [adding, setAdding] = useState(false);
  const [childName, setChildName] = useState('');
  const [selfName, setSelfName] = useState('');
  const [busy, setBusy] = useState(false);
  // 審查 P3-10：同步鎖，busy state 重繪前的連點不會重複建立學員或重複送出。
  const lock = useRef(false);
  const needSelfName = picked === SELF_NEW && !displayName.trim();

  async function addChild(): Promise<void> {
    if (lock.current) return;
    const name = childName.trim();
    if (!name) {
      toast.show({ message: ct('toast.nameRequired'), tone: 'warning' });
      return;
    }
    // 照 A edu-student-join：同一家長、同名、非退學的學員不重複建立。
    if (students.some((s) => s.parentUid === uid && s.name.trim() === name)) {
      toast.show({ message: ct('toast.childDup', { name }), tone: 'warning' });
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const created = await repo.createPendingStudent(team, { name, uid, relation: 'parent' });
      setStudents((list) => [...list, created]);
      setPicked(created.id);
      setChildName('');
      setAdding(false);
      toast.show({ message: ct('toast.childAdded'), tone: 'success' });
      onChanged();
    } catch (error) {
      console.error('[course.addChild]', error);
      toast.show({ message: ct(`err.${courseErrorCode(error)}`), tone: 'error' });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (lock.current) return;
    const option = options.find((o) => o.key === picked && !o.disabled);
    if (!option) {
      toast.show({ message: ct('err.NO_STUDENTS'), tone: 'warning' });
      return;
    }
    // 審查 P3-1：沒有 LINE 名稱時，建本人學員前要先填姓名（Rules 要求 name 非空），不讓它變成「操作失敗」。
    const ownName = (displayName.trim() || selfName.trim());
    if (!option.student && !ownName) {
      toast.show({ message: ct('toast.nameRequired'), tone: 'warning' });
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      let student = option.student;
      if (!student) {
        // 照 A applyCourseEnrollment：沒有本人學員時先建一筆 pending 的本人學員。
        const created = await repo.createPendingStudent(team, { name: ownName, uid, relation: 'self' });
        student = created;
        setStudents((list) => [...list, created]);
        setPicked(created.id);
      }
      await repo.register(team, plan.id, [student.id]);
      toast.show({ message: ct('toast.submitted'), tone: 'success' });
      onChanged();
      onClose();
    } catch (error) {
      const code = courseErrorCode(error);
      if (code === 'ALREADY_ENROLLED') {
        toast.show({ message: ct('toast.alreadyEnrolled') });
        onChanged();
        onClose();
        return;
      }
      if (code === 'UNKNOWN') console.error('[course.register]', error);
      toast.show({ message: ct(`err.${code}`), tone: 'error' });
      if (code === 'COURSE_FULL' || code === 'SIGNUP_CLOSED' || code === 'PLAN_ENDED') onChanged();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <BottomSheet open title={ct('sheet.who')} onClose={onClose} busy={busy} size="sm">
      <div class="ck" role="radiogroup" aria-label={ct('sheet.who')}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            class="ck-opt"
            role="radio"
            aria-checked={picked === o.key}
            disabled={o.disabled || busy}
            onClick={() => setPicked(o.key)}
          >
            <span class="ck-opt-rd" />
            <span class="ck-opt-name">{o.label}</span>
            {o.chip ? (
              <span class={`ck-chip ${o.chip === 'enrolled' ? 'ck-chip-acc' : 'ck-chip-warn'}`}>
                {ct(o.chip === 'enrolled' ? 'chip.enrolled' : o.chip === 'pending' ? 'chip.pending' : 'chip.studentPending')}
              </span>
            ) : null}
          </button>
        ))}
        {needSelfName ? (
          <div class="ck-add-row">
            <input
              class="ck-input"
              type="text"
              maxLength={40}
              value={selfName}
              placeholder={ct('sheet.selfName')}
              aria-label={ct('sheet.selfName')}
              onInput={(e) => setSelfName((e.currentTarget as HTMLInputElement).value)}
            />
          </div>
        ) : null}
        {adding ? (
          <div class="ck-add-row">
            <input
              class="ck-input"
              type="text"
              maxLength={40}
              value={childName}
              placeholder={ct('sheet.childName')}
              aria-label={ct('sheet.childName')}
              onInput={(e) => setChildName((e.currentTarget as HTMLInputElement).value)}
            />
            <button type="button" class="ck-btn" disabled={busy} onClick={() => { void addChild(); }}>
              {ct('btn.add')}
            </button>
          </div>
        ) : (
          <button type="button" class="ck-opt ck-opt-add" disabled={busy} onClick={() => setAdding(true)}>
            <IconPlus />
            <span class="ck-nowrap">{ct('btn.addChild')}</span>
          </button>
        )}
        <button
          type="button"
          class="ck-btn ck-btn-blk"
          disabled={busy || !options.some((o) => o.key === picked && !o.disabled)}
          onClick={() => { void submit(); }}
        >
          {ct('btn.submit')}
        </button>
      </div>
    </BottomSheet>
  );
}

// 臨時取消時限（預覽 ⓪～⑥）：正式元件＋假資料截圖，不連 Firebase、不登入。
// ?theme=light|dark；?part=0|1|2|3|4|5|53|6|7|8 只畫一塊（7＝夥伴報名窗取消同行者的警告、8＝讀不到操作者資料的中性警告，個人頁同一個框）（彈窗類一次只能開一個）。畫完設 window.__CPS_READY。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port 5193 → /dev-harness/late-cancel.html
import type { ComponentChildren, JSX } from 'preact';
import { render } from 'preact';
import { initLocale } from '@/i18n/i18n';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-line-height.css';
import '../styles/legacy/edu-info-btn.css';
import '../styles/legacy/admin-users.css';
import '@/ui/app-confirm.css';
import '@/features/events/legacy/activity.css';
import '@/features/events/components/legacy/event-detail-c2.css';
import { createDefaultFormState } from '@/features/events/data/event-form-model';
import { EventFormFields } from '@/features/events/components/event-form/EventFormFields';
import {
  buildCompanionLateCancelNote,
  buildLateCancelConfirm,
  lateCancelHint,
  type LateCancelUserInfo,
} from '@/features/events/data/late-cancel';
import { LateCancelConfirm } from '@/features/events/components/LateCancelConfirm';
import { AttendanceRosterTable } from '@/features/events/components/AttendanceRosterTable';
import { CompanionCancelModal } from '@/features/events/components/legacy/CompanionCancelModal';
import { UserCard } from '@/features/admin-users/components/UserCard';
import { mapUserDoc } from '@/features/admin-users/data/admin-users-model';

const params = new URLSearchParams(location.search);
document.documentElement.setAttribute('data-theme', params.get('theme') === 'dark' ? 'dark' : 'light');
const part = params.get('part') ?? '0';
const noop = (): void => undefined;
const HOUR = 3_600_000;
// 活動 2026/12/01 20:00 開始；「時限內」用 19:00，「時限外」用前一天。
const EVENT = { id: 'e1', title: '週三羽球', status: 'open', date: '2026/12/01 20:00~22:00', max: 12 };
const START = Date.parse('2026-12-01T20:00:00+08:00');
const NOW_IN = START - HOUR;

function Sec({ title, children }: { title: string; children: ComponentChildren }): JSX.Element {
  return (
    <section style="margin:0 0 18px">
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin:4px 2px 6px">{title}</div>
      {children}
    </section>
  );
}

function hint(event: Record<string, unknown>, label: string, btn: string): JSX.Element {
  const text = lateCancelHint(event, START - 24 * HOUR);
  return (
    <div style="margin-bottom:12px">
      <div style="font-size:11px;color:var(--text-muted)">{label}</div>
      <div class="detail-action-primary"><button class="primary-btn" type="button">{btn}</button></div>
      {text && <div class="detail-late-cancel-hint">{text}</div>}
    </div>
  );
}

function confirmOf(nowMs: number, waitlistCount: number, user: LateCancelUserInfo | null | undefined): JSX.Element | null {
  const content = buildLateCancelConfirm({ event: EVENT, nowMs, eligibleCount: 1, confirmedCount: 1, waitlistCount, user });
  return content ? <LateCancelConfirm content={content} onSettle={noop} /> : null;
}

function reg(id: string, userId: string, userName: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _docId: `r${id}`, userId, userName, status: 'confirmed', participantType: 'self',
    registeredAt: `2026-11-20T10:${id.padStart(2, '0')}:00Z`, ...extra,
  };
}
function mate(id: string, userId: string, userName: string, companionName: string): Record<string, unknown> {
  return reg(id, userId, userName, { participantType: 'companion', companionId: `c${id}`, companionName });
}

const sections: Record<string, () => JSX.Element | null> = {
  '0': () => (
    <Sec title="⓪ 活動頁：報名按鈕下方小字">
      {hint(EVENT, '未報名（預設 2 小時）', '我要報名')}
      {hint({ ...EVENT, lateCancelHours: 48 }, '最長（48 小時）', '我要報名')}
      {hint({ ...EVENT, lateCancelHours: 0 }, '不設定：不顯示', '我要報名')}
    </Sec>
  ),
  '1': () => (
    <Sec title="① 建立／編輯活動表單">
      <EventFormFields
        mode="create"
        state={createDefaultFormState()}
        onPatch={noop}
        titleLimit={16}
        canToggleRegion
        cover={{ previewUrl: '', onPickFile: noop }}
        location={{ statusText: '尚未設定地圖座標', statusState: 'empty', buttonText: '設定地圖座標', buttonDisabled: false, buttonLooksDisabled: false, summary: '', showClear: false, onOpenPicker: noop, onClear: noop }}
        delegates={{ chips: [], canManage: true, query: '', results: [], dropdownOpen: false, dropdownStatus: '', placeholder: '搜尋用戶...', inputDisabled: false, onQuery: noop, onFocus: noop, onPick: noop, onRemove: noop }}
      />
    </Sec>
  ),
  '2': () => confirmOf(START - 24 * HOUR, 3, null),
  '3': () => confirmOf(NOW_IN, 0, null),
  '4': () => confirmOf(NOW_IN, 0, {
    level: 'black', untilMs: START + 24 * HOUR, releaseAt: 3, recentMs: [NOW_IN - 24 * HOUR, NOW_IN - 48 * HOUR], total: 2,
  }),
  '7': () => {
    const note = buildCompanionLateCancelNote({
      event: EVENT, nowMs: NOW_IN, eligibleCount: 2, confirmedCount: 2, waitlistCount: 1, user: null, selfChecked: false,
    });
    return note ? <LateCancelConfirm content={{ ...note, cancelText: '保留名額', okText: '仍要取消' }} onSettle={noop} /> : null;
  },
  '8': () => confirmOf(NOW_IN, 2, undefined),
  '5': () => (
    <Sec title="⑤ 活動名單標籤／⑤-2 代報">
      <AttendanceRosterTable
        event={EVENT}
        registrations={[
          reg('1', 'u1', '思慈'), mate('2', 'u1', '思慈', '小安'), mate('3', 'u1', '思慈', '阿哲'),
          reg('4', 'u4', '阿華教練'), reg('5', 'u5', 'Kai'), reg('6', 'u6', '總管'), reg('7', 'u7', 'Selene'),
          mate('8', 'u8', 'Ting', '小雨'), mate('9', 'u9', 'Kai2', '阿凱'),
        ] as never}
        attendanceRecords={[]}
        roles={{ u4: 'coach', u6: 'super_admin' }}
        lateCancelTags={{ u1: 'black', u4: 'black', u5: 'red', u8: 'black', u9: 'red' }}
        onOpenProfile={noop}
      />
    </Sec>
  ),
  '53': () => (
    <CompanionCancelModal
      open
      selectAll={false}
      busy={false}
      eventTitle={EVENT.title}
      targets={[
        { registrationId: 'r1', isSelf: true, name: '思慈', status: 'confirmed', lateEligible: true },
        { registrationId: 'r2', isSelf: false, name: '小安', status: 'confirmed', lateEligible: true },
        { registrationId: 'r3', isSelf: false, name: '阿哲', status: 'confirmed', lateEligible: true },
      ]}
      lateCancel={{ event: EVENT, waitlistCount: 4, user: null }}
      onClose={noop}
      onConfirm={noop}
    />
  ),
  '6': () => (
    <Sec title="⑥ 用戶管理：解除臨取紅標">
      <UserCard
        user={mapUserDoc({
          displayName: 'Kai', role: 'user', region: '台中市', lastLogin: Date.parse('2026-07-15T10:53:00+08:00'),
          lateCancelLevel: 'red', lateCancelTotal: 3, lateCancelRecent: [Date.parse('2026-11-20T21:00:00+08:00')],
        }, 'u5')}
        actor={{ uid: 'admin', role: 'admin', hasPermission: () => true }}
        canViewRawUid={false}
        customRoles={[]}
        busy={false}
        onEdit={noop}
        onToggleRestriction={noop}
        onClearLateCancelRed={noop}
        onOpenProfile={noop}
      />
    </Sec>
  ),
};

// 同行者彈窗：固定「現在」在時限內，並只勾兩位同行者（預覽 ⑤-3）。
if (part === '53') {
  Date.now = () => NOW_IN;
  setTimeout(() => {
    [...document.querySelectorAll<HTMLInputElement>('input[name="cc-reg"]')].slice(1).forEach(box => box.click());
  }, 50);
}

async function main(): Promise<void> {
  await initLocale();
  render(
    <div class="legacy-ui" style="min-height:100vh;background:var(--bg-root);color:var(--text-primary);padding:12px 14px">
      {(sections[part] ?? sections['0'] ?? (() => null))()}
    </div>,
    document.getElementById('app')!,
  );
  setTimeout(() => {
    (window as unknown as { __CPS_READY: boolean }).__CPS_READY = true;
  }, 300);
}
void main();

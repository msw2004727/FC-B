// 站內信管理純規則：權限（照 A，不新增碼）、頁籤分組、計數、卡片按鈕、撰寫驗證與紀錄欄位、排程到期。
import { describe, expect, it } from 'vitest';

import {
  ROLE_TARGETS,
  PROCESSING_STALE_MS,
  buildAdminMessageRecord,
  canAccessMessagesPage,
  canBroadcastToTarget,
  composeTargetTypesFor,
  canComposeMessage,
  canDeleteMessage,
  canRunScheduledMessages,
  cardActionsOf,
  filterMessagesForTab,
  formatScheduleText,
  isProcessingStale,
  isScheduledDue,
  senderNameOf,
  shiftCounts,
  statusBadgeOf,
  targetLabelOf,
  validateCompose,
  type AdminMessage,
  type ComposeInput,
  type MessageViewer,
} from './admin-message-model';

function viewer(role: string, perms: readonly string[], uid: string | null = 'U1'): MessageViewer {
  return { uid, role, hasPermission: (code) => perms.includes(code) };
}

function msg(status: string, over: Partial<AdminMessage> = {}): AdminMessage {
  return { _docId: `d-${status}`, id: `mg_${status}`, title: 't', body: 'b', status, ...over };
}

const baseInput: ComposeInput = {
  category: 'system',
  title: '公告',
  body: '內容',
  targetType: 'all',
  schedule: '',
  team: null,
  user: null,
};

describe('權限（照 A：入口、發送、刪除；不新增權限碼）', () => {
  const cases = [
    { who: 'user 無碼', v: viewer('user', []), page: false, compose: false, del: false },
    { who: 'coach 無碼', v: viewer('coach', []), page: false, compose: false, del: false },
    { who: 'captain 無碼', v: viewer('captain', []), page: false, compose: false, del: false },
    { who: 'admin 有入口碼', v: viewer('admin', ['admin.messages.entry']), page: true, compose: true, del: true },
    { who: 'super_admin 有入口碼', v: viewer('super_admin', ['admin.messages.entry']), page: true, compose: true, del: true },
    { who: 'admin 只有 compose', v: viewer('admin', ['admin.messages.compose']), page: false, compose: true, del: false },
    { who: 'admin 只有 delete', v: viewer('admin', ['admin.messages.delete']), page: false, compose: false, del: true },
  ];
  for (const c of cases) {
    it(c.who, () => {
      expect(canAccessMessagesPage(c.v)).toBe(c.page);
      expect(canComposeMessage(c.v)).toBe(c.compose);
      expect(canDeleteMessage(c.v)).toBe(c.del);
    });
  }

  it('排程執行者：只限 admin／super_admin 且有入口碼', () => {
    expect(canRunScheduledMessages(viewer('admin', ['admin.messages.entry']))).toBe(true);
    expect(canRunScheduledMessages(viewer('super_admin', ['admin.messages.entry']))).toBe(true);
    expect(canRunScheduledMessages(viewer('coach', ['admin.messages.entry']))).toBe(false);
    expect(canRunScheduledMessages(viewer('admin', []))).toBe(false);
    expect(canRunScheduledMessages(viewer('admin', ['admin.messages.entry'], null))).toBe(false);
  });
});

describe('頁籤、計數與按鈕（A renderMsgManage）', () => {
  const items = ['sent', 'scheduled', 'processing', 'cancelled', 'recalled', 'deleted'].map((s) => msg(s));

  it('已排程頁籤含 scheduled＋processing＋cancelled，其他依狀態', () => {
    expect(filterMessagesForTab(items, 'scheduled').map((m) => m.status)).toEqual(['scheduled', 'processing', 'cancelled']);
    expect(filterMessagesForTab(items, 'sent').map((m) => m.status)).toEqual(['sent']);
    expect(filterMessagesForTab(items, 'recalled').map((m) => m.status)).toEqual(['recalled']);
    expect(filterMessagesForTab(items, 'deleted').map((m) => m.status)).toEqual(['deleted']);
  });

  it('計數就地調整：排程計數不含 cancelled', () => {
    const base = { sent: 3, scheduled: 1, recalled: 1, deleted: 0 };
    expect(shiftCounts(base, 'sent', 'recalled')).toEqual({ sent: 2, scheduled: 1, recalled: 2, deleted: 0 });
    expect(shiftCounts(base, 'scheduled', 'cancelled')).toEqual({ sent: 3, scheduled: 0, recalled: 1, deleted: 0 });
    expect(shiftCounts(base, 'cancelled', 'scheduled')).toEqual({ sent: 3, scheduled: 2, recalled: 1, deleted: 0 });
    expect(shiftCounts(base, null, 'sent')).toEqual({ sent: 4, scheduled: 1, recalled: 1, deleted: 0 });
    expect(shiftCounts(base, 'scheduled', 'processing')).toEqual(base);
  });

  it('各狀態按鈕照 A；刪除鍵與刪除 handler 共用 canDeleteMessage', () => {
    const full = viewer('admin', ['admin.messages.entry']);
    expect(cardActionsOf('sent', full)).toEqual(['view', 'recall', 'delete']);
    expect(cardActionsOf('scheduled', full)).toEqual(['view', 'cancelSchedule', 'delete']);
    expect(cardActionsOf('processing', full)).toEqual(['view']);
    expect(cardActionsOf('recalled', full)).toEqual(['view', 'delete']);
    expect(cardActionsOf('cancelled', full)).toEqual(['view', 'restoreSchedule', 'delete']);
    expect(cardActionsOf('deleted', full)).toEqual(['view']);
    const noDelete = viewer('admin', ['admin.messages.compose']);
    expect(cardActionsOf('sent', noDelete)).toEqual(['view', 'recall']);
  });

  it('狀態標籤 class 照 A statusMap', () => {
    expect(statusBadgeOf('sent').cls).toBe('active');
    expect(statusBadgeOf('scheduled').cls).toBe('scheduled');
    expect(statusBadgeOf('processing').cls).toBe('scheduled');
    expect(statusBadgeOf('recalled').cls).toBe('expired');
    expect(statusBadgeOf('deleted').cls).toBe('expired');
    expect(statusBadgeOf('cancelled').cls).toBe('empty');
    expect(statusBadgeOf('weird')).toEqual({ cls: 'empty', known: false });
  });

  it('對象文字：個人信顯示「暱稱（UID）」', () => {
    expect(targetLabelOf({ target: '阿明', targetUid: 'U9', targetName: '阿明' })).toBe('阿明（U9）');
    expect(targetLabelOf({ target: '全體用戶', targetUid: null })).toBe('全體用戶');
  });
});

describe('群發對象限制（照伺服器 deliverToInbox：全體／角色只准 admin 以上）', () => {
  it('admin／super_admin 全部對象；其他身分只留俱樂部與指定用戶', () => {
    expect(composeTargetTypesFor({ role: 'admin' })).toEqual(['all', 'coach', 'captain', 'venue_owner', 'coach_up', 'admin', 'team', 'individual']);
    expect(composeTargetTypesFor({ role: 'super_admin' })).toHaveLength(8);
    expect(composeTargetTypesFor({ role: 'coach' })).toEqual(['team', 'individual']);
    expect(canBroadcastToTarget({ role: 'coach' }, 'all')).toBe(false);
    expect(canBroadcastToTarget({ role: 'coach' }, 'coach_up')).toBe(false);
    expect(canBroadcastToTarget({ role: 'user' }, 'individual')).toBe(true);
  });
});

describe('處理中卡住（超過 10 分鐘）', () => {
  const now = Date.parse('2026-11-08T01:00:00Z');
  it('依搶占時間判斷；Timestamp、ISO、沒有時間都能處理', () => {
    const at = (ms: number) => ({ toMillis: () => ms });
    expect(isProcessingStale(msg('processing', { processingAt: at(now - PROCESSING_STALE_MS + 1000) }), now)).toBe(false);
    expect(isProcessingStale(msg('processing', { processingAt: at(now - PROCESSING_STALE_MS - 1000) }), now)).toBe(true);
    expect(isProcessingStale(msg('processing', { processingAt: { seconds: (now - PROCESSING_STALE_MS - 1000) / 1000 } }), now)).toBe(true);
    expect(isProcessingStale(msg('processing', { processingAt: new Date(now - 60_000).toISOString() }), now)).toBe(false);
    expect(isProcessingStale(msg('processing'), now)).toBe(true);
    expect(isProcessingStale(msg('scheduled'), now)).toBe(false);
  });

  it('卡住才多給取消排程與恢復排程', () => {
    const full = viewer('admin', ['admin.messages.entry']);
    expect(cardActionsOf('processing', full, true)).toEqual(['view', 'cancelSchedule', 'restoreSchedule']);
    expect(cardActionsOf('processing', full, false)).toEqual(['view']);
  });
});

describe('撰寫驗證與紀錄（A sendMessage）', () => {
  it('檢查順序：標題 → 內容 → 指定對象', () => {
    expect(validateCompose({ ...baseInput, title: ' ' })).toBe('titleRequired');
    expect(validateCompose({ ...baseInput, title: '一二三四五六七八九十十一十二' })).toBe('titleTooLong');
    expect(validateCompose({ ...baseInput, body: '' })).toBe('bodyRequired');
    expect(validateCompose({ ...baseInput, body: 'x'.repeat(301) })).toBe('bodyTooLong');
    expect(validateCompose({ ...baseInput, targetType: 'team' })).toBe('teamRequired');
    expect(validateCompose({ ...baseInput, targetType: 'individual' })).toBe('userRequired');
    expect(validateCompose(baseInput)).toBeNull();
  });

  it('立即發送：欄位照 A，台北時間字串，角色清單照 roleTargetMap', () => {
    const now = new Date('2026-11-02T02:05:00Z');
    const r = buildAdminMessageRecord({ ...baseInput, targetType: 'coach_up', category: 'activity' }, '站長', now);
    expect(r.id).toMatch(/^mg_\d+_[a-z0-9]+$/);
    expect(r).toMatchObject({
      title: '公告',
      body: '內容',
      category: 'activity',
      categoryName: '活動',
      target: '教練以上',
      targetUid: null,
      targetName: null,
      targetTeamId: null,
      targetRoles: [...(ROLE_TARGETS.coach_up ?? [])],
      targetType: 'coach_up',
      senderName: '站長',
      readRate: '-',
      time: '2026/11/02 10:05',
      status: 'sent',
      scheduledAt: null,
    });
  });

  it('指定用戶／俱樂部與排程', () => {
    const user = buildAdminMessageRecord({ ...baseInput, targetType: 'individual', user: { uid: 'U9', name: '阿明' } }, '系統');
    expect(user).toMatchObject({ target: '阿明', targetUid: 'U9', targetName: '阿明', targetRoles: null });
    const team = buildAdminMessageRecord({ ...baseInput, targetType: 'team', team: { id: 'tm_1', name: 'A隊' }, schedule: '2026-11-08T09:00' }, '系統');
    expect(team).toMatchObject({ target: 'A隊', targetTeamId: 'tm_1', status: 'scheduled', scheduledAt: '2026-11-08T09:00' });
    const all = buildAdminMessageRecord(baseInput, '系統');
    expect(all).toMatchObject({ target: '全體用戶', targetRoles: null });
  });

  it('發送人：暱稱優先，否則「系統」', () => {
    expect(senderNameOf('阿明')).toBe('阿明');
    expect(senderNameOf(null)).toBe('系統');
  });
});

describe('排程時間（台北牆鐘）', () => {
  it('datetime-local 字串以台北時間解讀與顯示', () => {
    expect(formatScheduleText('2026-11-08T09:00')).toBe('2026/11/08 09:00');
    expect(formatScheduleText('亂寫')).toBe('');
  });

  it('只有 scheduled 且到期才算到期', () => {
    const due = Date.parse('2026-11-08T01:00:00Z'); // 台北 09:00
    expect(isScheduledDue({ status: 'scheduled', scheduledAt: '2026-11-08T09:00' }, due)).toBe(true);
    expect(isScheduledDue({ status: 'scheduled', scheduledAt: '2026-11-08T09:01' }, due)).toBe(false);
    expect(isScheduledDue({ status: 'cancelled', scheduledAt: '2026-11-08T09:00' }, due)).toBe(false);
    expect(isScheduledDue({ status: 'scheduled', scheduledAt: null }, due)).toBe(false);
  });
});

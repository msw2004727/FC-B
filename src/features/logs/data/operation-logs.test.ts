import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OPERATION_LOGS_COLLECTION,
  OPERATION_LOGS_FETCH_LIMIT,
  buildOperationLogDiagnosticText,
  copyDiagnosticTextToClipboard,
  fetchOperationLogs,
  formatOperationLogCreatedAt,
  getOperationLogDocId,
  getOperationLogToneClass,
  getVisibleOperationLogs,
  matchesOperationLogKeyword,
  type OperationLogDoc,
} from './operation-logs';
import {
  ADMIN_LOG_TABS,
  OPLOG_TYPE_GROUPS,
  filterOperationLogsList,
  findOperationLogByDocId,
  getAvailableAdminLogTabs,
  normalizeAdminLogTab,
  paginateOperationLogs,
} from './log-center-model';

const mockCollection = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockQuery = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

const mockDb = { name: 'mock-db' };
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(() => Promise.resolve({ db: mockDb })),
}));

describe('operation-logs data & log-center-model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.mockReturnValue('col-ref');
    mockOrderBy.mockReturnValue('order-clause');
    mockLimit.mockReturnValue('limit-clause');
    mockQuery.mockReturnValue('query-ref');
  });

  it('fetchOperationLogs builds query with operationLogs, orderBy createdAt desc, limit 200', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'op_1001',
          data: () => ({
            actorUid: 'u1',
            operator: '王小明',
            type: 'event_create',
            typeName: '建立活動',
            content: '週五夜跑',
            eventId: 'ev_1',
            time: '05/01 18:00',
          }),
        },
      ],
    });

    const result = await fetchOperationLogs();

    expect(mockCollection).toHaveBeenCalledWith(mockDb, OPERATION_LOGS_COLLECTION);
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockLimit).toHaveBeenCalledWith(OPERATION_LOGS_FETCH_LIMIT);
    expect(mockQuery).toHaveBeenCalledWith('col-ref', 'order-clause', 'limit-clause');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      _docId: 'op_1001',
      id: 'op_1001',
      actorUid: 'u1',
      operator: '王小明',
      type: 'event_create',
      typeName: '建立活動',
      content: '週五夜跑',
      eventId: 'ev_1',
    });
  });

  it('formats createdAt from Timestamp, seconds, Date, or falls back to time/unmarked', () => {
    const fixedDate = new Date('2026-03-15T09:30:00Z');
    const expected = fixedDate.toLocaleString('zh-TW', { hour12: false });

    expect(
      formatOperationLogCreatedAt({ createdAt: { toDate: () => fixedDate } }),
    ).toBe(expected);

    expect(
      formatOperationLogCreatedAt({
        createdAt: { seconds: Math.floor(fixedDate.getTime() / 1000), nanoseconds: 0 },
      }),
    ).toBe(expected);

    expect(formatOperationLogCreatedAt({ createdAt: fixedDate })).toBe(expected);
    expect(formatOperationLogCreatedAt({ time: '03/15 17:30' })).toBe('03/15 17:30');
    expect(formatOperationLogCreatedAt({})).toBe('未標示');
  });

  it('matches keyword across operator, actorUid, type, typeName, content, eventId, docId', () => {
    const sample: OperationLogDoc = {
      _docId: 'op_999_abc',
      actorUid: 'UID_ABC_123',
      operator: '教練阿傑',
      type: 'tourn_approve',
      typeName: '賽事審批',
      content: '核准春季盃報名',
      eventId: 'evt_spring_01',
    };

    expect(matchesOperationLogKeyword(sample, '')).toBe(true);
    expect(matchesOperationLogKeyword(sample, '教練阿傑')).toBe(true);
    expect(matchesOperationLogKeyword(sample, 'uid_abc_123')).toBe(true);
    expect(matchesOperationLogKeyword(sample, 'tourn_approve')).toBe(true);
    expect(matchesOperationLogKeyword(sample, '賽事審批')).toBe(true);
    expect(matchesOperationLogKeyword(sample, '春季盃')).toBe(true);
    expect(matchesOperationLogKeyword(sample, 'evt_spring_01')).toBe(true);
    expect(matchesOperationLogKeyword(sample, 'op_999_abc')).toBe(true);
    expect(matchesOperationLogKeyword(sample, '不存在的字')).toBe(false);
  });

  it('filters by keyword, typeFilter, and hides duplicated logs', () => {
    const logs: OperationLogDoc[] = [
      { _docId: '1', operator: 'A', type: 'exp', content: '加分' },
      { _docId: '2', operator: 'B', type: 'role', content: '改角色' },
      // A _shouldHideDuplicatedOperationLog：取消報名、含「→」的角色變更不顯示。
      { _docId: '3', operator: 'A', type: 'cancel_signup', content: '取消報名' },
      { _docId: '4', operator: 'A', type: 'role', content: '小明 user → coach' },
    ];

    expect(getVisibleOperationLogs(logs)).toHaveLength(2);
    expect(filterOperationLogsList(logs, { typeFilter: 'exp' }).map((l) => l._docId)).toEqual(['1']);
    expect(filterOperationLogsList(logs, { keyword: '改角色' }).map((l) => l._docId)).toEqual(['2']);
    expect(
      filterOperationLogsList(logs, { keyword: 'a', typeFilter: 'role' }),
    ).toHaveLength(0);
  });

  it('sorts descending by createdAt and paginates 20 items per page', () => {
    const logs: OperationLogDoc[] = Array.from({ length: 25 }, (_, i) => ({
      _docId: `doc_${i + 1}`,
      createdAt: { seconds: 1000 + i },
      operator: `User${i + 1}`,
    }));

    const page1 = paginateOperationLogs(logs, 1);
    expect(page1.totalCount).toBe(25);
    expect(page1.totalPages).toBe(2);
    expect(page1.safePage).toBe(1);
    expect(page1.pageItems).toHaveLength(20);
    expect(getOperationLogDocId(page1.pageItems[0])).toBe('doc_25');

    const page2 = paginateOperationLogs(logs, 2);
    expect(page2.safePage).toBe(2);
    expect(page2.pageItems).toHaveLength(5);
    expect(getOperationLogDocId(page2.pageItems[4])).toBe('doc_1');

    const pageOverflow = paginateOperationLogs(logs, 99);
    expect(pageOverflow.safePage).toBe(2);
  });

  it('builds diagnostic text matching legacy format line by line', () => {
    const d = new Date('2026-04-01T10:00:00Z');
    const formattedTime = d.toLocaleString('zh-TW', { hour12: false });
    const log: OperationLogDoc = {
      _docId: 'op_123456',
      createdAt: d,
      type: 'event_edit',
      typeName: '編輯活動',
      operator: '管理員小華',
      actorUid: 'u_admin_1',
      content: '修改活動地點',
      eventId: 'ev_777',
    };

    const text = buildOperationLogDiagnosticText(log);
    expect(text).toBe(
      [
        'ToosterX 操作日誌診斷包',
        `時間：${formattedTime}`,
        '類型：編輯活動 (event_edit)',
        '操作者：管理員小華 / u_admin_1',
        '內容：修改活動地點',
        '活動 ID：ev_777',
        '文件 ID：op_123456',
      ].join('\n'),
    );

    const emptyText = buildOperationLogDiagnosticText({});
    expect(emptyText).toBe(
      [
        'ToosterX 操作日誌診斷包',
        '時間：未標示',
        '類型：未分類 (unknown)',
        '操作者：未標示 / 未標示',
        '內容：未標示',
        '活動 ID：無',
        '文件 ID：未標示',
      ].join('\n'),
    );
  });

  it('copies diagnostic text via navigator.clipboard.writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await copyDiagnosticTextToClipboard('diagnostic-payload');
    expect(writeText).toHaveBeenCalledWith('diagnostic-payload');
  });

  it('validates tabs order, role visibility, tone class, and findOperationLogByDocId', () => {
    expect(ADMIN_LOG_TABS.map((t) => t.key)).toEqual([
      'operation',
      'audit',
      'error',
      'prompt',
      'chat',
    ]);
    expect(getAvailableAdminLogTabs('admin').map((t) => t.key)).toEqual([
      'operation',
      'audit',
      'error',
      'prompt',
    ]);
    expect(getAvailableAdminLogTabs('super_admin').map((t) => t.key)).toEqual([
      'operation',
      'audit',
      'error',
      'prompt',
      'chat',
    ]);
    expect(normalizeAdminLogTab('chat', 'admin')).toBe('operation');
    expect(normalizeAdminLogTab('chat', 'super_admin')).toBe('chat');

    expect(getOperationLogToneClass('event_create')).toBe('log-tone-green');
    expect(getOperationLogToneClass('unknown_xyz')).toBe('log-tone-gray');

    const totalOptions = OPLOG_TYPE_GROUPS.reduce((sum, g) => sum + g.options.length, 0);
    expect(totalOptions).toBe(29);

    const found = findOperationLogByDocId('op_2', [{ _docId: 'op_1' }], [{ id: 'op_2' }]);
    expect(found).toEqual({ id: 'op_2' });
    expect(findOperationLogByDocId('missing', [{ _docId: 'op_1' }])).toBeNull();
  });
});

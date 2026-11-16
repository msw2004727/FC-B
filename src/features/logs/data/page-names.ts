/**
 * 頁面代碼 → 中文頁面名（2026-11-16 日誌中心第二批）。
 * 為什麼：錯誤日誌／用戶提示的頁面欄要顯示中文，診斷包仍保留原始代碼（顧問 §3.200 第 5 項）。
 */

const OLD_PAGE_LABELS: Record<string, string> = {
  'page-home': '首頁',
  'page-activities': '活動',
  'page-activity-detail': '活動詳情',
  'page-my-activities': '我的活動',
  'page-teams': '俱樂部',
  'page-team-detail': '俱樂部詳情',
  'page-team-manage': '俱樂部管理',
  'page-tournaments': '賽事',
  'page-tournament-detail': '賽事詳情',
  'page-profile': '個人頁',
  'page-user-card': '球員卡',
  'page-qrcode': 'QR 碼',
  'page-qr-uid': 'QR 碼',
  'page-qr-canvas': 'QR 碼',
  'page-scan': '掃碼簽到',
  'page-messages': '訊息',
  'page-leaderboard': '排行榜',
  'page-personal-dashboard': '個人數據',
  'page-game': '小遊戲',
  'page-kick-game': '小遊戲',
  'page-admin-users': '用戶管理',
  'page-admin-logs': '日誌中心',
  'page-admin-dashboard': '數據儀表板',
  'page-admin-roles': '角色權限',
  'page-admin-repair': '用戶補正',
  activity: '活動',
  home: '首頁',
  profile: '個人頁',
  teams: '俱樂部',
};

function normalizePath(raw: string): string {
  const noHash = raw.split('#')[0] ?? raw;
  const noQuery = noHash.split('?')[0] ?? noHash;
  const trimmed = noQuery.length > 1 ? noQuery.replace(/\/+$/, '') : noQuery;
  return trimmed || '/';
}

function newPathLabel(path: string): string | null {
  if (path === '/') return '首頁';
  if (path === '/activities') return '活動';
  if (path.startsWith('/events/')) return '活動詳情';
  if (path === '/my-activities') return '我的活動';
  if (path === '/teams') return '俱樂部';
  if (path.startsWith('/teams/')) return '俱樂部詳情';
  if (path === '/team-manage') return '俱樂部管理';
  if (path === '/tournaments') return '賽事';
  if (path === '/profile') return '個人頁';
  if (path === '/profile/qr') return 'QR 碼';
  if (path.startsWith('/profile/')) return '球員卡';
  if (path === '/checkin') return '掃碼簽到';
  if (path === '/inbox') return '訊息';
  if (path === '/leaderboard') return '排行榜';
  if (path === '/me/dashboard') return '個人數據';
  if (path === '/courses' || path.startsWith('/courses/') || path === '/course-manage' || path.startsWith('/course-manage/')) return '課程';
  if (path === '/games') return '小遊戲';
  if (path === '/admin/users') return '用戶管理';
  if (path === '/admin/logs') return '日誌中心';
  if (path.startsWith('/admin/ops')) return '數據儀表板';
  if (path === '/admin/roles') return '角色權限';
  if (path === '/admin/repair') return '用戶補正';
  if (path.startsWith('/admin/')) return '後台';
  return null;
}

/** 為什麼：日誌中心頁面欄統一由這裡轉中文，沒對照保留原字（顧問 §3.200 第 5 項）。 */
export function pageLabel(raw: string): string {
  const text = String(raw ?? '').trim();
  if (!text || text === 'unknown') return '未標示';
  if (text.startsWith('/')) {
    const label = newPathLabel(normalizePath(text));
    return label || text;
  }
  const label = OLD_PAGE_LABELS[text];
  if (label) return label;
  if (text.startsWith('page-edu-')) return '課程';
  if (text.startsWith('page-admin-')) return '後台';
  return text;
}

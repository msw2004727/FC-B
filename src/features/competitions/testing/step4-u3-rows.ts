// 指派清單的正式頁示範資料（cp-step4-u3 示範頁與 step4b 預覽測試共用）。
// 名稱照正式規則：自己「我自己」，其他人「成員 {memberNo}」（K10 配發、不回收）。
// 假資料：主辦 1、共同主辦 2、記分員 3、5（4 號已移除，不重排）、裁判 6。
import type { StaffListRow } from '../step4b/staff';

export const U3_HOST_ROWS: StaffListRow[] = [
  { id: 'me', name: '我自己', role: 'host', roleLabel: '主辦', countLabel: '0 場', removable: false },
  { id: 'co', name: '成員 2', role: 'coHost', roleLabel: '共同主辦', countLabel: '0 場', removable: false },
  { id: 's1', name: '成員 3', role: 'scorer', roleLabel: '記分員', countLabel: '4 場', removable: true },
  { id: 's2', name: '成員 5', role: 'scorer', roleLabel: '記分員', countLabel: '1 場', removable: true },
  { id: 'ref', name: '成員 6', role: 'referee', roleLabel: '裁判', countLabel: '1 場', removable: true },
];

export const U3_COHOST_ROWS: StaffListRow[] = [
  { id: 'host', name: '成員 1', role: 'host', roleLabel: '主辦', countLabel: '0 場', removable: false },
  { id: 'me', name: '我自己', role: 'coHost', roleLabel: '共同主辦', countLabel: '0 場', removable: false },
  { id: 's1', name: '成員 3', role: 'scorer', roleLabel: '記分員', countLabel: '4 場', removable: true },
  { id: 's2', name: '成員 5', role: 'scorer', roleLabel: '記分員', countLabel: '1 場', removable: true },
  { id: 'ref', name: '成員 6', role: 'referee', roleLabel: '裁判', countLabel: '1 場', removable: true },
];

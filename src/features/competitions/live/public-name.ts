import { surnameOf } from '../data/names';

/**
 * 榜上與觀眾列只顯示公開名。
 * 未成年只留姓氏（複姓照 surnameOf）；成人沿用名單上的 displayName。
 */
export function publicRosterName(displayName: string, isMinor: boolean): string {
  if (!isMinor) return displayName;
  const surname = surnameOf(displayName);
  return surname || displayName;
}

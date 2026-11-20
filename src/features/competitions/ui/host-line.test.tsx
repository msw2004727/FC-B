import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompetitionsT } from '../i18n';
import { HostLine } from './public-board';

// 獨立審 B P2：個人主辦有聯絡文字時，主辦名稱只在招募中（有傳 hostType）顯示，與 409c4d77 的公開範圍相同；
// 俱樂部主辦一律顯示名稱與「聯絡主辦」。ct 用鍵名本身代替，只驗結構。
const ct = ((key: string) => key) as unknown as CompetitionsT;
const noop = () => {};

afterEach(() => cleanup());

describe('頂部主辦列 HostLine', () => {
  it('個人主辦、招募中：主辦｜名稱｜個人主辦標籤，沒有聯絡主辦鈕，下一行聯絡文字', () => {
    const view = render(<HostLine ct={ct} hostName="王示範" hostType="個人主辦" contactNote="賽前到集合點找我" clubTeamId={null} onOpenClub={noop} />);
    const row = view.container.querySelector('.cpm-contact');
    expect(row?.querySelector('.cpm-host')?.textContent).toBe('王示範');
    expect(row?.textContent ?? '').toContain('個人主辦');
    expect(view.container.querySelector('.ui-button')).toBeNull();
    expect(view.container.querySelector('.cpm-public')?.textContent).toBe('賽前到集合點找我');
  });

  it('個人主辦、非招募中（沒有 hostType）：不顯示名稱', () => {
    const view = render(<HostLine ct={ct} hostName="王示範" contactNote="賽前到集合點找我" clubTeamId={null} onOpenClub={noop} />);
    expect(view.container.querySelector('.cpm-host')).toBeNull();
    expect(view.container.querySelector('.cpm-public')?.textContent).toBe('賽前到集合點找我');
  });

  it('俱樂部主辦：名稱與聯絡主辦鈕都在', () => {
    const view = render(<HostLine ct={ct} hostName="海風俱樂部" contactNote={null} clubTeamId="club_1" onOpenClub={noop} />);
    expect(view.container.querySelector('.cpm-host')?.textContent).toBe('海風俱樂部');
    expect(view.container.querySelector('.ui-button')?.textContent).toBe('contactHost');
  });
});

import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/preact';
import { FavSportTags, NewEventToggleRow } from './ProfileBits';

afterEach(() => cleanup());

describe('FavSportTags', () => {
  it('顯示標籤（i18n 運動名稱）', () => {
    render(<FavSportTags tags={['football', 'basketball']} />);
    expect(screen.getByText('足球')).toBeTruthy();
    expect(screen.getByText('籃球')).toBeTruthy();
  });

  it('editing 時每個標籤有 × 按鈕，onRemove 收到 key', () => {
    const onRemove = vi.fn();
    render(<FavSportTags tags={['football']} editing onRemove={onRemove} />);
    const btn = screen.getByLabelText('移除足球');
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('football');
  });

  it('非 editing 時沒有 × 按鈕', () => {
    render(<FavSportTags tags={['football']} />);
    expect(screen.queryByLabelText('移除足球')).toBeNull();
  });

  it('tags 空時顯示 legacyText', () => {
    render(<FavSportTags tags={[]} legacyText="其他運動" />);
    const legacy = screen.getByText('其他運動');
    expect(legacy.className).toContain('fav-legacy');
  });

  it('tags 非空時不顯示 legacyText', () => {
    render(<FavSportTags tags={['football']} legacyText="其他運動" />);
    expect(screen.queryByText('其他運動')).toBeNull();
  });

  it('「喜好通知＋」按鈕呼叫 onAdd', () => {
    const onAdd = vi.fn();
    render(<FavSportTags tags={[]} onAdd={onAdd} />);
    fireEvent.click(screen.getByText('喜好通知＋'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe('NewEventToggleRow', () => {
  it('從 false 切到 true：onChange 收到相反值（true）', () => {
    const onChange = vi.fn();
    render(<NewEventToggleRow checked={false} onChange={onChange} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.change(input, { target: { checked: true } });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('從 true 切到 false：onChange 收到相反值（false）', () => {
    const onChange = vi.fn();
    render(<NewEventToggleRow checked={true} onChange={onChange} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.change(input, { target: { checked: false } });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('disabled 時套用於 input', () => {
    const onChange = vi.fn();
    render(<NewEventToggleRow checked={false} disabled onChange={onChange} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('名稱與說明走 i18n', () => {
    render(<NewEventToggleRow checked={true} onChange={() => undefined} />);
    expect(screen.getByText('每日新活動')).toBeTruthy();
    expect(screen.getByText('你選的運動，每天第一場新活動通知你')).toBeTruthy();
  });
});

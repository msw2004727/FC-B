import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import {
  S4B_PLAYERS,
  S4B_TEAM_THUNDER,
  S4B_TIEBREAK,
  STEP4B_SCREENS,
} from '../testing/step4b-fixtures';
import { copy, criterionLabel } from './copy';
import {
  AdditionReviewScreen,
  AuditLogScreen,
  CheckinPrintScreen,
  LinkJoinScreen,
  RulesAdvancedScreen,
  RulesPublicScreen,
  renderStep4bScreen,
} from './index';

afterEach(() => {
  cleanup();
});

describe('step4b 預覽畫面', () => {
  it('十七個畫面都畫得出來，而且沒有開發用語', () => {
    for (const screen of STEP4B_SCREENS) {
      const view = render(renderStep4bScreen(screen));
      const text = view.container.textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('第 5 步');
      expect(text).not.toContain('無限制回場');
      cleanup();
    }
  });

  it('已用背號不能選', () => {
    const view = render(<LinkJoinScreen />);
    const taken = view.container.querySelector<HTMLOptionElement>('#s4b-number option[value="1"]');
    const open = view.container.querySelector<HTMLOptionElement>('#s4b-number option[value="7"]');
    expect(taken?.disabled).toBe(true);
    expect(taken?.label).toBe(copy.numberUsed(1));
    expect(open?.disabled).toBe(false);
    expect(open?.label).toBe('7');
  });

  it('監護人勾選只在未成年出現', () => {
    const adult = render(<LinkJoinScreen minor={false} />);
    expect(adult.container.textContent ?? '').not.toContain('監護人');
    cleanup();
    const minor = render(<LinkJoinScreen />);
    expect(minor.container.textContent ?? '').toContain(copy.guardian);
  });

  it('拒絕增補沒填原因就不能送出', () => {
    const view = render(<AdditionReviewScreen />);
    const reject = view.getAllByRole('button', { name: copy.reject })[0];
    if (!reject) throw new Error('找不到拒絕');
    fireEvent.click(reject);
    fireEvent.click(view.getByRole('button', { name: copy.rejectSubmit }));
    expect(view.getByRole('alert').textContent).toContain(copy.reasonRequired);
    expect(view.container.textContent ?? '').toContain('新手');
  });

  it('公開規則分成系統計算與主辦執行', () => {
    const view = render(<RulesPublicScreen />);
    const text = view.container.textContent ?? '';
    expect(text).not.toContain('第 5 步');
    expect(text).not.toContain('無限制回場');
    expect(text).toContain('自由換人（換下可再上場）');
    expect(text).toContain(copy.fairLater);
    expect(text.indexOf(copy.sysCalc)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(copy.sysCalc)).toBeLessThan(text.indexOf(copy.hostDoes));
    const fairAt = text.indexOf(criterionLabel.fairPlay);
    const hintAt = text.indexOf(copy.fairHint);
    expect(fairAt).toBeGreaterThanOrEqual(0);
    expect(hintAt).toBeGreaterThan(fairAt);
    let cursor = 0;
    for (const key of S4B_TIEBREAK) {
      const at = text.indexOf(criterionLabel[key], cursor);
      expect(at).toBeGreaterThanOrEqual(cursor);
      cursor = at + criterionLabel[key].length;
    }
  });

  it('進階警告不擋儲存，有內容的補充說明直接展開', () => {
    const view = render(<RulesAdvancedScreen />);
    expect(view.container.textContent ?? '').toContain(copy.pointsWarnWin);
    const save = view.getByRole('button', { name: copy.save });
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(save.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(view.getByRole('button', { name: copy.advanced }));
    expect(view.container.textContent ?? '').toContain(copy.fairHint);
    const note = view.getByRole('textbox', { name: copy.noteLabel });
    expect((note as HTMLTextAreaElement).value).toBe(copy.fairNote);
    expect(view.getAllByRole('button', { name: copy.addNote })).toHaveLength(4);
  });

  it('系統只提醒不擋上場，只在有限換人出現', () => {
    const limited = render(<RulesAdvancedScreen subMode="limited" />);
    expect(limited.container.textContent ?? '').toContain(copy.subHint);
    cleanup();
    const free = render(<RulesAdvancedScreen />);
    expect(free.container.textContent ?? '').not.toContain(copy.subHint);
  });

  it('檢錄真名只給主辦或該隊代表，列數等於名單', () => {
    const other = render(<CheckinPrintScreen viewer="other" />);
    const otherText = other.container.textContent ?? '';
    expect(otherText).not.toContain('陳大明');
    expect(otherText).not.toContain('王大同');
    expect(otherText).toContain('阿明');
    expect(other.container.querySelectorAll('[data-player]')).toHaveLength(S4B_PLAYERS.length);
    cleanup();

    const host = render(<CheckinPrintScreen viewer="host" />);
    const hostText = host.container.textContent ?? '';
    expect(hostText).toContain('陳大明');
    expect(hostText).toContain('王大同');
    expect(host.container.querySelectorAll('[data-player]')).toHaveLength(S4B_PLAYERS.length);
    cleanup();

    const rep = render(<CheckinPrintScreen viewer="rep" repTeamId={S4B_TEAM_THUNDER} />);
    const repText = rep.container.textContent ?? '';
    expect(repText).toContain('陳大明');
    expect(repText).not.toContain('王大同');
    expect(rep.container.querySelectorAll('[data-player]')).toHaveLength(S4B_PLAYERS.length);
  });

  it('稽核有改前改後，不出現 uid', () => {
    const view = render(<AuditLogScreen />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('改前 1:0');
    expect(text).toContain('改後 2:0');
    expect(text).not.toContain('uid_host_9f3a');
    expect(text).not.toContain('uid_admin_22c1');
  });
});

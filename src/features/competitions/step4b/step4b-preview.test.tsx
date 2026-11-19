import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import zhTW from '../locales-lazy/zh-TW.json';
import {
  S4B_CLAIM_NUMBER,
  S4B_CLAIM_TEAM,
  S4B_COMP_NAME,
  S4B_PLAYERS,
  S4B_TEAM_THUNDER,
  S4B_TIEBREAK,
  STEP4B_SCREENS,
} from '../testing/step4b-fixtures';
import { auditActorLabel, copy, criterionLabel } from './copy';
import {
  AdditionRequestScreen,
  AdditionReviewScreen,
  AuditLogScreen,
  CheckinPrintScreen,
  ClaimScreen,
  InviteAcceptScreen,
  LinkJoinScreen,
  RulesAdvancedScreen,
  RulesPublicScreen,
  RulesTemplateScreen,
  ScheduleMidnightScreen,
  StaffListScreen,
  renderStep4bScreen,
} from './index';
import { shownRuleLines } from './rules';

afterEach(() => {
  cleanup();
});

describe('step4b 預覽畫面', () => {
  it('每個畫面都畫得出來，而且沒有開發用語', () => {
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
    expect(copy.guardian).toBe(zhTW.guardianConsent);
    expect(copy.privacy).toBe(zhTW.ackDisplayName);
    const adult = render(<LinkJoinScreen />);
    expect(adult.container.textContent ?? '').not.toContain('監護人');
    cleanup();
    const minor = render(<LinkJoinScreen minor />);
    expect(minor.container.textContent ?? '').toContain(copy.guardian);
    cleanup();
    const preview = render(renderStep4bScreen('link-join'));
    expect(preview.container.textContent ?? '').not.toContain('監護人');
    cleanup();
    const minorScreen = render(renderStep4bScreen('link-join-minor'));
    expect(minorScreen.container.textContent ?? '').toContain(copy.guardian);
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
    const rank = `8. ${criterionLabel.fairPlay}`;
    const rankAt = text.indexOf(rank);
    const hintAt = text.indexOf(`${copy.fairLater}・${copy.fairHint}`);
    expect(rankAt).toBeGreaterThanOrEqual(0);
    expect(hintAt).toBeGreaterThan(rankAt);
    expect(text).not.toContain(copy.unset);
    expect(text).not.toContain(copy.kitTitle);
    expect(text).not.toContain(copy.appealTitle);
    expect(text).toContain(copy.suspLine);
    expect(text).toContain(copy.lateLine);
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
    fireEvent.input(note, { target: { value: '改成這句' } });
    expect((view.getByRole('textbox', { name: copy.noteLabel }) as HTMLTextAreaElement).value).toBe('改成這句');
    expect(view.getAllByRole('button', { name: copy.addNote })).toHaveLength(4);
    const add = view.getAllByRole('button', { name: copy.addNote })[0];
    if (!add) throw new Error('找不到補充說明');
    fireEvent.click(add);
    const boxes = view.getAllByRole('textbox', { name: copy.noteLabel }) as HTMLTextAreaElement[];
    const empty = boxes.find((box) => box.value === '');
    if (!empty) throw new Error('找不到空的補充說明');
    fireEvent.input(empty, { target: { value: '補一句' } });
    const values = (view.getAllByRole('textbox', { name: copy.noteLabel }) as HTMLTextAreaElement[]).map((box) => box.value);
    expect(values).toContain('補一句');
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
    cleanup();

    const missed = render(<CheckinPrintScreen viewer="rep" />);
    const missedText = missed.container.textContent ?? '';
    expect(missedText).not.toContain('陳大明');
    expect(missedText).not.toContain('王大同');
    expect(missedText).not.toContain('林志遠');
    expect(missedText).toContain('阿明');
    expect(missedText).not.toContain(copy.colReal);
    cleanup();

    const bare = render(<CheckinPrintScreen />);
    expect(bare.container.textContent ?? '').not.toContain('陳大明');
    cleanup();

    const preview = render(renderStep4bScreen('checkin-print'));
    expect(preview.container.textContent ?? '').toContain('陳大明');
  });

  it('稽核有改前改後與操作者角色，不出現 uid', () => {
    const view = render(<AuditLogScreen />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('改前 1:0');
    expect(text).toContain('改後 2:0');
    expect(text).not.toContain('uid_');
    for (const label of Object.values(auditActorLabel)) {
      expect(text).toContain(`操作者：${label}`);
    }
  });

  it('未勾同意不能加入、不能認領、不能送出增補', () => {
    const adult = render(<LinkJoinScreen />);
    const join = adult.getByRole('button', { name: copy.join });
    expect(join.hasAttribute('disabled')).toBe(true);
    fireEvent.click(adult.getByRole('checkbox', { name: copy.privacy }));
    expect(adult.getByRole('button', { name: copy.join }).hasAttribute('disabled')).toBe(false);
    cleanup();

    const minor = render(<LinkJoinScreen minor />);
    expect(minor.getByRole('button', { name: copy.join }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(minor.getByRole('checkbox', { name: copy.privacy }));
    expect(minor.getByRole('button', { name: copy.join }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(minor.getByRole('checkbox', { name: copy.guardian }));
    expect(minor.getByRole('button', { name: copy.join }).hasAttribute('disabled')).toBe(false);
    cleanup();

    const claim = render(<ClaimScreen />);
    const claimText = claim.container.textContent ?? '';
    expect(claimText).toContain(S4B_COMP_NAME);
    expect(claimText).toContain(S4B_CLAIM_TEAM);
    expect(claimText).toContain(copy.claimLine(S4B_CLAIM_TEAM, S4B_CLAIM_NUMBER));
    expect(claimText).not.toContain('監護人');
    expect(claim.getByRole('button', { name: copy.claimYes }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(claim.getByRole('checkbox', { name: copy.privacy }));
    expect(claim.getByRole('button', { name: copy.claimYes }).hasAttribute('disabled')).toBe(false);
    cleanup();

    const claimMinor = render(<ClaimScreen minor />);
    expect(claimMinor.getByRole('button', { name: copy.claimYes }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(claimMinor.getByRole('checkbox', { name: copy.privacy }));
    expect(claimMinor.getByRole('button', { name: copy.claimYes }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(claimMinor.getByRole('checkbox', { name: copy.guardian }));
    expect(claimMinor.getByRole('button', { name: copy.claimYes }).hasAttribute('disabled')).toBe(false);
    cleanup();

    const add = render(<AdditionRequestScreen />);
    expect(add.container.textContent ?? '').toContain(copy.selfConsent);
    expect(add.container.textContent ?? '').not.toContain(copy.guardian);
    expect(add.getByRole('button', { name: copy.addSubmit }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(add.getByRole('checkbox', { name: copy.selfConsent }));
    // 名單公開告知也要勾（顧問 §3.306-3，比照正式代填頁）
    expect(add.getByRole('button', { name: copy.addSubmit }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(add.getByRole('checkbox', { name: copy.addAck }));
    expect(add.getByRole('button', { name: copy.addSubmit }).hasAttribute('disabled')).toBe(false);
    fireEvent.input(add.getByLabelText(copy.birthday), { target: { value: '2016-05-20' } });
    expect(add.container.textContent ?? '').toContain(copy.guardian);
    expect(add.container.textContent ?? '').not.toContain(copy.selfConsent);
    expect(add.getByRole('button', { name: copy.addSubmit }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(add.getByRole('checkbox', { name: copy.guardian }));
    expect(add.getByRole('button', { name: copy.addSubmit }).hasAttribute('disabled')).toBe(false);
  });

  it('互斥狀態一頁只顯示一種，錯誤時沒有表單', () => {
    const full = render(<LinkJoinScreen status="rosterFull" />);
    expect(full.container.textContent ?? '').toContain(copy.rosterFullTitle);
    expect(full.container.textContent ?? '').not.toContain(copy.linkDeadTitle);
    expect(full.queryByRole('button', { name: copy.join })).toBeNull();
    expect(full.container.querySelector('[data-reason="ROSTER_FULL"]')).not.toBeNull();
    cleanup();

    const dead = render(<LinkJoinScreen status="invalid" />);
    expect(dead.container.textContent ?? '').toContain(copy.linkDead);
    expect(dead.container.textContent ?? '').not.toContain(copy.rosterFullTitle);
    expect(dead.queryByRole('button', { name: copy.join })).toBeNull();
    cleanup();

    const open = render(<LinkJoinScreen />);
    expect(open.container.textContent ?? '').not.toContain(copy.rosterFullTitle);
    expect(open.container.textContent ?? '').not.toContain(copy.linkDeadTitle);
    expect(open.getByRole('button', { name: copy.join })).toBeTruthy();
    cleanup();

    const active = render(<InviteAcceptScreen />);
    expect(active.getByRole('button', { name: copy.accept })).toBeTruthy();
    expect(active.container.textContent ?? '').not.toContain(copy.inviteRevoked);
    expect(active.container.textContent ?? '').not.toContain(copy.inviteExpired);
    expect(active.container.textContent ?? '').not.toContain(copy.compCancelled);
    cleanup();

    const expired = render(<InviteAcceptScreen status="expired" />);
    expect(expired.container.textContent ?? '').toContain(copy.inviteExpired);
    expect(expired.container.textContent ?? '').not.toContain(copy.inviteRevoked);
    expect(expired.container.textContent ?? '').not.toContain(copy.compCancelled);
    expect(expired.queryByRole('button', { name: copy.accept })).toBeNull();
    cleanup();

    const revoked = render(<InviteAcceptScreen status="revoked" />);
    expect(revoked.container.textContent ?? '').toContain(copy.inviteRevoked);
    expect(revoked.container.textContent ?? '').not.toContain(copy.inviteExpired);
    expect(revoked.queryByRole('button', { name: copy.accept })).toBeNull();
    cleanup();

    const cancelled = render(<InviteAcceptScreen status="cancelled" />);
    expect(cancelled.container.textContent ?? '').toContain(copy.compCancelled);
    expect(cancelled.container.textContent ?? '').not.toContain(copy.inviteExpired);
    expect(cancelled.queryByRole('button', { name: copy.accept })).toBeNull();
    cleanup();

    const claim = render(<ClaimScreen />);
    expect(claim.getByRole('button', { name: copy.claimYes })).toBeTruthy();
    expect(claim.container.textContent ?? '').not.toContain(copy.claimAge);
    cleanup();

    const mismatch = render(<ClaimScreen status="ageMismatch" />);
    expect(mismatch.container.textContent ?? '').toContain(copy.claimAge);
    expect(mismatch.queryByRole('button', { name: copy.claimYes })).toBeNull();
    expect(mismatch.container.querySelector('[data-screen="claim-age-mismatch"]')).not.toBeNull();
  });

  it('指派清單依視角決定誰能移除', () => {
    function removeButton(view: { container: Element }, name: string): HTMLButtonElement | null {
      const row = [...view.container.querySelectorAll('.s4b-li')].find((el) => (el.textContent ?? '').includes(name));
      if (!row) return null;
      return [...row.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === copy.remove) ?? null;
    }
    const host = render(<StaffListScreen />);
    expect(removeButton(host, '王主辦')).toBeNull();
    expect(removeButton(host, '李共同')).not.toBeNull();
    expect(removeButton(host, '林記分')).not.toBeNull();
    expect(removeButton(host, '陳裁判')).not.toBeNull();
    const coButton = removeButton(host, '李共同');
    if (!coButton) throw new Error('主辦應該能移除共同主辦');
    fireEvent.click(coButton);
    expect(host.container.textContent ?? '').not.toContain('李共同');
    cleanup();

    const cohost = render(renderStep4bScreen('staff-list-cohost'));
    expect(cohost.container.querySelector('[data-screen="staff-list-cohost"]')).not.toBeNull();
    expect(removeButton(cohost, '王主辦')).toBeNull();
    expect(removeButton(cohost, '李共同')).toBeNull();
    expect(removeButton(cohost, '林記分')).not.toBeNull();
    expect(removeButton(cohost, '陳裁判')).not.toBeNull();
  });

  it('增補核可寫出年齡是否符合組別', () => {
    const view = render(<AdditionReviewScreen />);
    const text = view.container.textContent ?? '';
    expect(text).toContain(copy.ageFit(true));
    expect(text).toContain(copy.ageFit(false));
    const warn = view.container.querySelector('.s4b-age-no');
    expect(warn?.textContent ?? '').toContain('否');
    expect(warn?.textContent ?? '').not.toContain('是');
  });

  it('規則範本是一行摘要', () => {
    const view = render(<RulesTemplateScreen />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('5 人・每半場 20 分・中場 5 分');
    expect(text).toContain('7 人・每半場 25 分・中場 5 分');
    expect(text).toContain('11 人・每半場 35 分・中場 10 分');
    expect(text).not.toContain('人數：');
    expect(shownRuleLines(['護脛：未設定', '同色球衣：自備'])).toEqual(['同色球衣：自備']);
    expect(shownRuleLines(['護脛：未設定', '號碼：未設定'])).toEqual([]);
    expect(shownRuleLines([copy.fairHint])).toEqual([copy.fairHint]);
  });

  it('跨午夜場次顯示 1/10 00:20 與隔日', () => {
    const view = render(<ScheduleMidnightScreen />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('1/10 00:20');
    expect(text).toContain(copy.nextDay);
    const row = [...view.container.querySelectorAll('.s4b-m')].find((el) => (el.textContent ?? '').includes('1/10 00:20'));
    expect(row?.textContent ?? '').toContain(copy.nextDay);
    expect(text).toContain('1/9');
  });
});

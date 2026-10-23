/**
 * TeamSettingsModal 行為契約。
 *
 * 對應 A team-detail.js:620–830 的設定 DOM、分類與逐控制項寫入。
 * 欄位對照（A ↔ B，同名同型）：
 * type ↔ type；teachingEnabled ↔ teachingEnabled；eduSettings ↔ eduSettings；
 * allowMemberInvite ↔ allowMemberInvite；themeColor ↔ themeColor；
 * themeOverlayEnabled ↔ themeOverlayEnabled；detailVisibility ↔ detailVisibility。
 * eduSettings 的 patch null 由寫入層轉為刪除欄位。
 *
 * Rules 邊界依本卡契約：經理三欄位身分或 team.manage_all；
 * 元件共用 canEditTeamSettings，不自行擴充授權。本測試不冒充 Rules 驗證。
 * 測試資料只使用假 id / uid；不執行真實資料寫入。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushOverlay } from '@/core/overlay-back';
import { lockBody } from '@/ui/Modal';
import { toast } from '@/ui/Toast';

import { canEditTeamSettings } from '../../club-policy';
import { saveTeamSettingsPatch } from '../../data/teams-write';
import type { ClubViewer, TeamDoc } from '../../data/types';
import { TeamSettingsModal, type TeamSettingsModalProps } from './TeamSettingsModal';

vi.mock('../../data/teams-write', () => ({
  saveTeamSettingsPatch: vi.fn(),
}));
vi.mock('../../club-policy', () => ({
  canEditTeamSettings: vi.fn(),
}));
vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));
vi.mock('@/core/overlay-back', () => ({
  pushOverlay: vi.fn(),
}));
vi.mock('@/ui/Modal', () => ({
  lockBody: vi.fn(),
}));
vi.mock('@/i18n/i18n', () => ({
  useLegacyT: () => (_key: string, fallback: string): string => fallback,
}));

const saveMock = vi.mocked(saveTeamSettingsPatch);
const policyMock = vi.mocked(canEditTeamSettings);
const toastMock = vi.mocked(toast.show);
const overlayMock = vi.mocked(pushOverlay);
const lockMock = vi.mocked(lockBody);
const releaseBack = vi.fn();
const unlockBody = vi.fn();

const viewer: ClubViewer = {
  uid: 'U-test-1',
  teamIds: new Set(['tm_test_1']),
  hasPermission: () => false,
};

function makeTeam(overrides: Partial<TeamDoc> = {}): TeamDoc {
  return {
    id: 'tm_test_1',
    _docId: 'tm_test_1',
    type: 'competitive',
    ...overrides,
  };
}

function setup(team = makeTeam(), overrides: Partial<TeamSettingsModalProps> = {}) {
  const props: TeamSettingsModalProps = {
    team,
    viewer,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onEditBasic: vi.fn(),
    ...overrides,
  };
  return { ...render(<TeamSettingsModal {...props} />), props };
}

it('設定彈窗渲染遮罩，點擊不關閉，卸載後移除', () => {
  policyMock.mockReturnValue(true);
  lockMock.mockReturnValue(unlockBody);
  overlayMock.mockReturnValue(releaseBack);

  const { unmount, props } = setup();
  try {
    const overlay = document.querySelector('.modal-overlay.open');
    expect(overlay).not.toBeNull();
    if (!(overlay instanceof HTMLElement)) throw new Error('找不到設定彈窗遮罩');

    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.hasAttribute('id')).toBe(false);
    fireEvent.click(overlay);
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog', { name: '俱樂部設定' }));
    expect(props.onClose).not.toHaveBeenCalled();
  } finally {
    unmount();
  }

  expect(document.querySelector('.modal-overlay.open')).toBeNull();
});

function checkbox(label: string): HTMLInputElement {
  const node = document.querySelector(
    `label.td-settings-switch[aria-label="${label}"] input`,
  );
  if (!(node instanceof HTMLInputElement)) {
    throw new Error(`找不到設定 switch：${label}`);
  }
  return node;
}

function categoryButton(label: string): HTMLButtonElement {
  const group = screen.getByRole('radiogroup', { name: '俱樂部標籤' });
  const node = within(group).getByRole('button', { name: new RegExp(`^${label}`) });
  if (!(node instanceof HTMLButtonElement)) throw new Error('找不到分類按鈕');
  return node;
}

function colorInput(): HTMLInputElement {
  const node = screen.getByLabelText('俱樂部主題色');
  if (!(node instanceof HTMLInputElement)) throw new Error('找不到主題色輸入');
  return node;
}

/**
 * color input 的原生 setter 會清洗非法值並可能將大寫轉為小寫。
 * 以暫時的 own value 模擬 handler 收到的原值，驗證真正的 normalize helper；
 * 仍派送原生 change，避免 preact/compat 將 fireEvent.change 改成 input（L-42）。
 */
function changeColor(value: string): void {
  const input = colorInput();
  act(() => {
    Object.defineProperty(input, 'value', {
      configurable: true,
      writable: true,
      value,
    });
    try {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      Reflect.deleteProperty(input, 'value');
    }
  });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function expectSuccess(): Promise<void> {
  await waitFor(() => {
    expect(toastMock).toHaveBeenCalledWith({
      message: '設定已更新',
      tone: 'success',
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockReset();
  saveMock.mockResolvedValue(undefined);
  policyMock.mockReturnValue(true);
  overlayMock.mockReturnValue(releaseBack);
  lockMock.mockReturnValue(unlockBody);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('俱樂部設定彈窗', () => {
  it('渲染對話框、四個分類、教學七列與初始關閉焦點', async () => {
    setup(makeTeam({ type: 'education' }));

    const dialog = screen.getByRole('dialog', { name: '俱樂部設定' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('data-no-backdrop-close')).toBe('1');
    expect(dialog.id).toBe('team-detail-settings-modal');
    expect(dialog.parentElement?.className).toBe('legacy-ui');
    expect(screen.getByRole('heading', { name: '俱樂部設定' }).id)
      .toBe('team-detail-settings-title');

    const group = screen.getByRole('radiogroup', { name: '俱樂部標籤' });
    expect(within(group).getAllByRole('button')).toHaveLength(4);
    for (const label of ['無', '競技', '教學', '休閒']) {
      const button = categoryButton(label);
      expect(button.classList.contains('active')).toBe(label === '教學');
      expect(button.getAttribute('aria-pressed')).toBe(String(label === '教學'));
    }

    for (const label of ['活動', '俱樂部課程', '俱樂部賽事', '俱樂部資訊', '簡介', '戰績', '成員列表']) {
      expect(checkbox(label).checked).toBe(true);
    }
    expect(screen.getAllByRole('checkbox')).toHaveLength(9);
    expect(screen.getByRole('button', { name: '編輯基本資料' })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '關閉' }));
    });
    expect(lockMock).toHaveBeenCalledWith(document.body);
  });

  it('非教學分類不渲染俱樂部課程列', () => {
    setup();
    expect(screen.queryByText('俱樂部課程')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
  });

  it('Esc、關閉鈕與返回鍵關閉，但點遮罩不關閉', async () => {
    const { props } = setup();
    await waitFor(() => expect(overlayMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('dialog'));
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);

    const onBack = overlayMock.mock.calls[0]?.[0];
    if (!onBack) throw new Error('未註冊返回鍵');
    expect(onBack()).toBe(true);
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });

  it('卸載釋放返回鍵與 body lock，並移除 Esc listener', async () => {
    const { unmount, props } = setup();
    await waitFor(() => expect(overlayMock).toHaveBeenCalledTimes(1));
    unmount();

    expect(releaseBack).toHaveBeenCalledTimes(1);
    expect(unlockBody).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each([
    '分類', '邀請', '主題色', '預設', '遮罩', '欄位',
  ])('無權限操作%s時拒絕寫入並使用相同權限 helper', (control) => {
    policyMock.mockReturnValue(false);
    const team = makeTeam();
    setup(team);

    switch (control) {
      case '分類':
        fireEvent.click(categoryButton('教學'));
        break;
      case '邀請':
        fireEvent.click(checkbox('隊員可邀請'));
        expect(checkbox('隊員可邀請').checked).toBe(true);
        break;
      case '主題色':
        changeColor('#112233');
        break;
      case '預設':
        fireEvent.click(screen.getByRole('button', { name: '預設' }));
        break;
      case '遮罩':
        fireEvent.click(checkbox('半透明遮罩'));
        expect(checkbox('半透明遮罩').checked).toBe(true);
        break;
      case '欄位':
        fireEvent.click(checkbox('活動'));
        expect(checkbox('活動').checked).toBe(true);
        break;
    }

    expect(policyMock).toHaveBeenCalledWith(viewer, team);
    expect(saveMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith({
      message: '您沒有編輯此俱樂部的權限',
      tone: 'error',
    });
  });

  it.each([undefined, false, true])(
    '切換教學保留既有設定與 acceptingStudents=%s',
    async (acceptingStudents) => {
      const eduSettings = {
        teachingEnabled: false,
        students: ['既有學員'],
        customSetting: '保留',
        ...(acceptingStudents === undefined ? {} : { acceptingStudents }),
      };
      const team = makeTeam({ eduSettings });
      setup(team);

      fireEvent.click(categoryButton('教學'));
      expect(saveMock).toHaveBeenCalledExactlyOnceWith(team, {
        type: 'education',
        teachingEnabled: true,
        eduSettings: {
          ...eduSettings,
          acceptingStudents: acceptingStudents !== false,
          teachingEnabled: true,
        },
      });
      await expectSuccess();
    },
  );

  it('切換休閒關閉教學並以 null 刪除教學設定', async () => {
    const team = makeTeam({ type: 'education', teachingEnabled: true });
    setup(team);

    fireEvent.click(categoryButton('休閒'));
    expect(saveMock).toHaveBeenCalledExactlyOnceWith(team, {
      type: 'leisure',
      teachingEnabled: false,
      eduSettings: null,
    });
    await expectSuccess();
    expect(screen.queryByText('俱樂部課程')).toBeNull();
  });

  it('B 小改良：點目前分類不寫入，結果資料與 A 相同', () => {
    setup();
    fireEvent.click(categoryButton('競技'));
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('邀請缺欄位預設開啟，切換只寫入 allowMemberInvite', async () => {
    const team = makeTeam();
    setup(team);

    expect(checkbox('隊員可邀請').checked).toBe(true);
    fireEvent.click(checkbox('隊員可邀請'));
    expect(saveMock).toHaveBeenCalledExactlyOnceWith(team, { allowMemberInvite: false });
    await expectSuccess();
    expect(checkbox('隊員可邀請').checked).toBe(false);
  });

  it.each(['#112233', '#ABCDEF'])('合法主題色 %s 依實際 helper 保留大小寫', async (color) => {
    const team = makeTeam();
    setup(team);

    changeColor(color);
    // 附件 normalizeTeamThemeColor 驗證格式但不轉小寫。
    expect(saveMock).toHaveBeenCalledExactlyOnceWith(team, { themeColor: color });
    await expectSuccess();
  });

  it('主題色派送 input 事件模擬拖動色盤時不寫入', () => {
    setup();
    const input = colorInput();

    act(() => {
      for (const color of ['#112233', '#445566', '#778899']) {
        input.value = color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    expect(saveMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('非法主題色顯示錯誤且不寫入', () => {
    setup();
    changeColor('invalid');

    expect(saveMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith({
      message: '主題色格式不正確',
      tone: 'error',
    });
  });

  it('圓點使用 team 主題色，預設按鈕寫入 null', async () => {
    const team = makeTeam({ themeColor: '#112233' });
    setup(team);

    const dot = document.querySelector('.td-theme-current');
    if (!(dot instanceof HTMLElement)) throw new Error('找不到主題色圓點');
    const expected = document.createElement('span');
    expected.style.background = '#112233';
    expect(dot.style.background).toBe(expected.style.background);
    expect(colorInput().value).toBe('#112233');

    fireEvent.click(screen.getByRole('button', { name: '預設' }));
    expect(saveMock).toHaveBeenCalledExactlyOnceWith(team, { themeColor: null });
    await expectSuccess();
    expect(dot.style.background).toBe('');
    expect(colorInput().value).toBe('#0d9488');
  });

  it('遮罩缺欄位預設開啟，切換寫入 false', async () => {
    const team = makeTeam();
    setup(team);

    expect(checkbox('半透明遮罩').checked).toBe(true);
    fireEvent.click(checkbox('半透明遮罩'));
    expect(saveMock).toHaveBeenCalledExactlyOnceWith(team, { themeOverlayEnabled: false });
    await expectSuccess();
  });

  it('欄位顯示以完整物件寫入並保留原有 bio 設定', async () => {
    const team = makeTeam({ detailVisibility: { bio: false } });
    setup(team);

    expect(checkbox('簡介').checked).toBe(false);
    fireEvent.click(checkbox('活動'));
    expect(saveMock).toHaveBeenCalledExactlyOnceWith(team, {
      detailVisibility: { bio: false, events: false },
    });
    expect(team.detailVisibility).toEqual({ bio: false });
    await expectSuccess();
  });

  // 測試同步更新：成功但未重讀的設定必須成為後續整包寫入的基準。
  it.each(['重讀拒絕', '重讀完成但 prop 不變'] as const)(
    '%s 時依序關閉活動與成員，保留兩次成功結果',
    async (outcome) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const onSaved = vi.fn<() => Promise<void>>();
      if (outcome === '重讀拒絕') onSaved.mockRejectedValue(new Error('重讀失敗'));
      else onSaved.mockResolvedValue(undefined);
      const team = makeTeam({ detailVisibility: { events: true, members: true } });
      setup(team, { onSaved });

      fireEvent.click(checkbox('活動'));
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(checkbox('活動').disabled).toBe(false);
      });
      expect(checkbox('活動').checked).toBe(false);

      fireEvent.click(checkbox('成員列表'));
      expect(saveMock).toHaveBeenNthCalledWith(2, team, {
        detailVisibility: { events: false, members: false },
      });
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(2);
        expect(checkbox('成員列表').disabled).toBe(false);
      });
      expect(checkbox('活動').checked).toBe(false);
      expect(checkbox('成員列表').checked).toBe(false);
      expect(team.detailVisibility).toEqual({ events: true, members: true });
    },
  );

  // 測試同步更新：同 id、舊內容、新引用不得清除成功基準。
  it('重讀拒絕後收到舊內容的新 team，第二次 visibility 保留第一次成功值', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onSaved = vi.fn().mockRejectedValue(new Error('重讀失敗'));
    const original = makeTeam({ detailVisibility: { events: true, members: true } });
    const { rerender, props } = setup(original, { onSaved });

    fireEvent.click(checkbox('活動'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(checkbox('活動').disabled).toBe(false);
    });

    const stale = makeTeam({ detailVisibility: { events: true, members: true } });
    expect(stale).not.toBe(original);
    expect(stale.id).toBe(original.id);
    rerender(<TeamSettingsModal {...props} team={stale} />);
    expect(checkbox('活動').checked).toBe(false);

    fireEvent.click(checkbox('成員列表'));
    expect(saveMock).toHaveBeenNthCalledWith(2, stale, {
      detailVisibility: { events: false, members: false },
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
      expect(checkbox('成員列表').disabled).toBe(false);
    });
    expect(checkbox('活動').checked).toBe(false);
    expect(checkbox('成員列表').checked).toBe(false);
  });

  // 測試同步更新：先確認第二次 patch，再用後續 prop 變更證明已同步項目確實移除。
  it('新 team 反映成功值後清除 confirmed，後續以 prop 為基準', async () => {
    const onSaved = vi.fn();
    const original = makeTeam({ detailVisibility: { events: true, members: true } });
    const { rerender, props } = setup(original, { onSaved });

    fireEvent.click(checkbox('活動'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(checkbox('活動').disabled).toBe(false);
    });

    const reflected = makeTeam({ detailVisibility: { events: false, members: true } });
    rerender(<TeamSettingsModal {...props} team={reflected} />);
    fireEvent.click(checkbox('成員列表'));
    expect(saveMock).toHaveBeenNthCalledWith(2, reflected, {
      detailVisibility: { events: false, members: false },
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
      expect(checkbox('成員列表').disabled).toBe(false);
    });

    rerender(
      <TeamSettingsModal
        {...props}
        team={makeTeam({ detailVisibility: { events: false, members: false } })}
      />,
    );
    rerender(
      <TeamSettingsModal
        {...props}
        team={makeTeam({ detailVisibility: { events: true, members: true } })}
      />,
    );
    expect(checkbox('活動').checked).toBe(true);
    expect(checkbox('成員列表').checked).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  // 測試同步更新：等待寫入期間換引用，既有成功值與本次成功值都必須保留。
  it('寫入等待期間替換同隊引用，完成後不丟失成功項目', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onSaved = vi.fn().mockRejectedValue(new Error('重讀失敗'));
    const original = makeTeam({ detailVisibility: { events: true, members: true } });
    const { rerender, props } = setup(original, { onSaved });

    fireEvent.click(checkbox('活動'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(checkbox('活動').disabled).toBe(false);
    });

    const write = deferred();
    saveMock.mockReturnValueOnce(write.promise);
    fireEvent.click(checkbox('成員列表'));
    expect(saveMock).toHaveBeenNthCalledWith(2, original, {
      detailVisibility: { events: false, members: false },
    });

    const stale = makeTeam({ detailVisibility: { events: true, members: true } });
    rerender(<TeamSettingsModal {...props} team={stale} />);
    expect(checkbox('活動').checked).toBe(false);
    expect(checkbox('成員列表').disabled).toBe(true);

    await act(async () => {
      write.resolve();
      await write.promise;
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
      expect(checkbox('成員列表').disabled).toBe(false);
      expect(checkbox('活動').checked).toBe(false);
      expect(checkbox('成員列表').checked).toBe(false);
    });

    fireEvent.click(checkbox('簡介'));
    expect(saveMock).toHaveBeenNthCalledWith(3, stale, {
      detailVisibility: { events: false, members: false, bio: false },
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(3);
      expect(checkbox('簡介').disabled).toBe(false);
    });
  });

  // 測試同步更新：detailVisibility 逐子 key 清除，未同步項目繼續保留。
  it('新 team 只反映部分 visibility 時，只移除相同的子 key', async () => {
    const onSaved = vi.fn();
    const original = makeTeam({ detailVisibility: { events: true, members: true } });
    const { rerender, props } = setup(original, { onSaved });

    fireEvent.click(checkbox('活動'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(checkbox('活動').disabled).toBe(false);
    });
    fireEvent.click(checkbox('成員列表'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
      expect(checkbox('成員列表').disabled).toBe(false);
    });

    rerender(
      <TeamSettingsModal
        {...props}
        team={makeTeam({ detailVisibility: { events: false, members: true } })}
      />,
    );
    expect(checkbox('活動').checked).toBe(false);
    expect(checkbox('成員列表').checked).toBe(false);

    const next = makeTeam({ detailVisibility: { events: true, members: true } });
    rerender(<TeamSettingsModal {...props} team={next} />);
    expect(checkbox('活動').checked).toBe(true);
    expect(checkbox('成員列表').checked).toBe(false);
    fireEvent.click(checkbox('簡介'));
    expect(saveMock).toHaveBeenNthCalledWith(3, next, {
      detailVisibility: { events: true, members: false, bio: false },
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(3);
      expect(checkbox('簡介').disabled).toBe(false);
    });
  });

  // 測試同步更新：物件以序列化內容比對；相同內容的新物件可解除成功覆蓋。
  it('eduSettings 保留至新 team 反映相同內容，再接受後續 prop 設定', async () => {
    const onSaved = vi.fn();
    const original = makeTeam({
      eduSettings: { acceptingStudents: false, teachingEnabled: false },
    });
    const { rerender, props } = setup(original, { onSaved });

    fireEvent.click(categoryButton('教學'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(categoryButton('教學').disabled).toBe(false);
    });

    const stale = makeTeam({
      eduSettings: { acceptingStudents: true, teachingEnabled: false },
    });
    rerender(<TeamSettingsModal {...props} team={stale} />);
    expect(categoryButton('教學').getAttribute('aria-pressed')).toBe('true');

    rerender(
      <TeamSettingsModal
        {...props}
        team={makeTeam({
          type: 'education',
          teachingEnabled: true,
          eduSettings: { acceptingStudents: false, teachingEnabled: true },
        })}
      />,
    );

    const next = makeTeam({
      type: 'competitive',
      teachingEnabled: false,
      eduSettings: { acceptingStudents: true, teachingEnabled: false },
    });
    rerender(<TeamSettingsModal {...props} team={next} />);
    expect(categoryButton('競技').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(categoryButton('教學'));
    expect(saveMock).toHaveBeenNthCalledWith(2, next, {
      type: 'education',
      teachingEnabled: true,
      eduSettings: { acceptingStudents: true, teachingEnabled: true },
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
      expect(categoryButton('教學').disabled).toBe(false);
    });
  });

  // 測試同步更新
  it('onSaved 正常並更新 prop 後，後續 visibility 寫入使用新 prop', async () => {
    const original = makeTeam({ detailVisibility: { events: true, members: true } });
    const onSaved = vi.fn();
    const { rerender, props } = setup(original, { onSaved });

    fireEvent.click(checkbox('活動'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(checkbox('活動').disabled).toBe(false);
    });

    const refreshed = makeTeam({
      detailVisibility: { events: false, members: true, bio: false },
    });
    rerender(<TeamSettingsModal {...props} team={refreshed} />);
    fireEvent.click(checkbox('成員列表'));

    expect(saveMock).toHaveBeenNthCalledWith(2, refreshed, {
      detailVisibility: { events: false, members: false, bio: false },
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
      expect(checkbox('成員列表').disabled).toBe(false);
    });
    expect(checkbox('活動').checked).toBe(false);
    expect(checkbox('簡介').checked).toBe(false);
  });

  it('visibility 寫入失敗不污染 confirmed，也不清除前次成功設定', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const team = makeTeam({ detailVisibility: { events: true, members: true } });
    const onSaved = vi.fn().mockRejectedValue(new Error('重讀失敗'));
    setup(team, { onSaved });

    fireEvent.click(checkbox('活動'));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(checkbox('活動').disabled).toBe(false);
    });

    saveMock.mockRejectedValueOnce(new Error('寫入失敗'));
    fireEvent.click(checkbox('成員列表'));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        message: '設定更新失敗，請稍後再試',
        tone: 'error',
      });
      expect(checkbox('成員列表').disabled).toBe(false);
    });
    expect(checkbox('活動').checked).toBe(false);
    expect(checkbox('成員列表').checked).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);

    fireEvent.click(checkbox('活動'));
    expect(saveMock).toHaveBeenNthCalledWith(3, team, {
      detailVisibility: { events: true, members: true },
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
      expect(checkbox('活動').disabled).toBe(false);
    });
  });

  it('其他設定成功後不因下一次寫入或失敗而回跳', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onSaved = vi.fn().mockRejectedValue(new Error('重讀失敗'));
    setup(makeTeam({ themeColor: '#445566' }), { onSaved });
    let savedCount = 0;
    const settled = async () => {
      savedCount += 1;
      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(savedCount);
        expect(document.querySelector(
          '#team-detail-settings-body input:disabled, #team-detail-settings-body button:disabled',
        )).toBeNull();
      });
    };

    fireEvent.click(checkbox('隊員可邀請'));
    await settled();
    fireEvent.click(checkbox('半透明遮罩'));
    await settled();
    changeColor('#112233');
    await settled();
    fireEvent.click(categoryButton('教學'));
    await settled();
    fireEvent.click(checkbox('活動'));
    await settled();

    expect(checkbox('隊員可邀請').checked).toBe(false);
    expect(checkbox('半透明遮罩').checked).toBe(false);
    expect(colorInput().value).toBe('#112233');
    expect(categoryButton('教學').getAttribute('aria-pressed')).toBe('true');
    expect(checkbox('活動').checked).toBe(false);

    saveMock.mockRejectedValueOnce(new Error('主題色寫入失敗'));
    changeColor('#778899');
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        message: '設定更新失敗，請稍後再試',
        tone: 'error',
      });
      expect(colorInput().disabled).toBe(false);
    });
    expect(colorInput().value).toBe('#112233');
    expect(checkbox('隊員可邀請').checked).toBe(false);
    expect(checkbox('半透明遮罩').checked).toBe(false);
    expect(categoryButton('教學').getAttribute('aria-pressed')).toBe('true');
    expect(checkbox('活動').checked).toBe(false);
  });

  it('依序等待寫入、onSaved，再顯示成功通知', async () => {
    const write = deferred();
    const refresh = deferred();
    const order: string[] = [];
    saveMock.mockImplementation(() => {
      order.push('寫入');
      return write.promise;
    });
    const onSaved = vi.fn(() => {
      order.push('onSaved');
      return refresh.promise;
    });
    toastMock.mockImplementation(() => {
      order.push('toast');
      return 1;
    });
    setup(makeTeam(), { onSaved });

    fireEvent.click(checkbox('隊員可邀請'));
    expect(order).toEqual(['寫入']);
    await act(async () => {
      write.resolve();
      await write.promise;
    });
    expect(order).toEqual(['寫入', 'onSaved']);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(checkbox('隊員可邀請').disabled).toBe(true);

    await act(async () => {
      refresh.resolve();
      await refresh.promise;
    });
    await expectSuccess();
    expect(order).toEqual(['寫入', 'onSaved', 'toast']);
    expect(checkbox('隊員可邀請').disabled).toBe(false);
    toastMock.mockReset();
  });

  it('寫入失敗回復 checkbox，解除鎖後可再次成功操作', async () => {
    const error = new Error('寫入失敗');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    saveMock.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const { props } = setup();

    fireEvent.click(checkbox('隊員可邀請'));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        message: '設定更新失敗，請稍後再試',
        tone: 'error',
      });
    });
    expect(checkbox('隊員可邀請').checked).toBe(true);
    expect(checkbox('隊員可邀請').disabled).toBe(false);
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[TeamSettingsModal]', error);

    fireEvent.click(checkbox('隊員可邀請'));
    await expectSuccess();
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(props.onSaved).toHaveBeenCalledTimes(1);
  });

  it('分類寫入失敗回復 team prop 分類', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    saveMock.mockRejectedValueOnce(new Error('分類寫入失敗'));
    setup();

    fireEvent.click(categoryButton('教學'));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        message: '設定更新失敗，請稍後再試',
        tone: 'error',
      });
    });
    expect(categoryButton('競技').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('俱樂部課程')).toBeNull();
  });

  it('主題色寫入失敗回復 team prop 色碼', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    saveMock.mockRejectedValueOnce(new Error('色碼寫入失敗'));
    setup(makeTeam({ themeColor: '#445566' }));

    changeColor('#112233');
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        message: '設定更新失敗，請稍後再試',
        tone: 'error',
      });
    });
    expect(colorInput().value).toBe('#445566');
    expect(colorInput().disabled).toBe(false);
  });

  it('onSaved 拒絕仍回報寫入成功並捕捉拒絕', async () => {
    const error = new Error('重讀失敗');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onSaved = vi.fn().mockRejectedValue(error);
    setup(makeTeam(), { onSaved });

    fireEvent.click(checkbox('隊員可邀請'));
    await expectSuccess();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('[TeamSettingsModal] onSaved', error);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(checkbox('隊員可邀請').checked).toBe(false);
    expect(checkbox('隊員可邀請').disabled).toBe(false);
  });

  it('寫入中停用來源控制項，重複操作及其他控制項操作不再寫入', async () => {
    const write = deferred();
    saveMock.mockReturnValueOnce(write.promise);
    setup();

    const invite = checkbox('隊員可邀請');
    fireEvent.click(invite);
    expect(invite.disabled).toBe(true);
    fireEvent.click(invite);

    // 其他控制項仍可接收事件，但共用 ref 鎖必須拒絕第二筆寫入。
    const overlay = checkbox('半透明遮罩');
    fireEvent.click(overlay);
    expect(overlay.checked).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      write.resolve();
      await write.promise;
    });
    await expectSuccess();
    expect(invite.disabled).toBe(false);
    expect(invite.checked).toBe(false);
  });

  // 測試同步更新：純量成功值須等 prop 反映後才移除。
  it('成功後收到未反映成功值的新 team，保留成功值直到同步', async () => {
    const { rerender, props } = setup();
    fireEvent.click(checkbox('隊員可邀請'));
    await expectSuccess();
    expect(checkbox('隊員可邀請').checked).toBe(false);

    rerender(
      <TeamSettingsModal
        {...props}
        team={makeTeam({ allowMemberInvite: true, themeColor: '#445566' })}
      />,
    );
    expect(checkbox('隊員可邀請').checked).toBe(false);
    expect(colorInput().value).toBe('#445566');

    rerender(
      <TeamSettingsModal {...props} team={makeTeam({ allowMemberInvite: false })} />,
    );
    expect(checkbox('隊員可邀請').checked).toBe(false);

    rerender(
      <TeamSettingsModal {...props} team={makeTeam({ allowMemberInvite: true })} />,
    );
    expect(checkbox('隊員可邀請').checked).toBe(true);
  });

  // 測試同步更新：onSaved 尚未完成時收到舊內容新引用也不能清除成功值。
  it('父層在 onSaved 完成前傳入未同步 team，完成後保留已成功值', async () => {
    const refresh = deferred();
    const onSaved = vi.fn(() => refresh.promise);
    const { rerender, props } = setup(makeTeam(), { onSaved });

    fireEvent.click(checkbox('隊員可邀請'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    rerender(
      <TeamSettingsModal {...props} team={makeTeam({ allowMemberInvite: true })} />,
    );
    expect(checkbox('隊員可邀請').checked).toBe(false);

    await act(async () => {
      refresh.resolve();
      await refresh.promise;
    });
    await expectSuccess();
    expect(checkbox('隊員可邀請').checked).toBe(false);
    expect(checkbox('隊員可邀請').disabled).toBe(false);
  });

  it.each(['成功', '失敗'])('卸載後寫入%s不再通知或呼叫 onSaved', async (outcome) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const write = deferred();
    saveMock.mockReturnValueOnce(write.promise);
    const { unmount, props } = setup();

    fireEvent.click(checkbox('隊員可邀請'));
    unmount();

    await act(async () => {
      if (outcome === '成功') write.resolve();
      else write.reject(new Error('卸載後寫入失敗'));
      await write.promise.catch(() => undefined);
    });

    expect(props.onSaved).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(releaseBack).toHaveBeenCalledTimes(1);
    expect(unlockBody).toHaveBeenCalledTimes(1);
  });

  it('編輯基本資料按鈕呼叫父層回呼且不寫入', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: '編輯基本資料' }));
    expect(props.onEditBasic).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });
});

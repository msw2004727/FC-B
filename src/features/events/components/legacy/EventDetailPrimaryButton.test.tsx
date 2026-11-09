import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import type { SignupButtonState } from '../../data/signup-state';
import {
  EventDetailPrimaryButton,
  ringPercent,
  type EventDetailPrimaryButtonProps,
} from './EventDetailPrimaryButton';

vi.mock('./signup-a11y.css', () => ({}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeState(overrides: Partial<SignupButtonState> = {}): SignupButtonState {
  return {
    kind: 'signup',
    label: '立即報名',
    labelKey: 'events.detailPage.button.signup',
    disabled: false,
    action: 'signup',
    tone: 'primary',
    variant: 'primary',
    glow: 'var(--accent)',
    glowLight: 'var(--accent-hover)',
    hint: '報名中',
    glowWrap: true,
    ...overrides,
  };
}

function renderButton(overrides: Partial<EventDetailPrimaryButtonProps> = {}) {
  const props: EventDetailPrimaryButtonProps = {
    state: makeState(),
    disabled: false,
    busy: false,
    onClick: () => {},
    ...overrides,
  };
  return render(<EventDetailPrimaryButton {...props} />);
}

const cancelState = makeState({
  kind: 'cancel',
  label: '取消報名',
  action: 'cancel',
  tone: 'danger',
  variant: 'styled',
  bg: '#dc2626',
  color: '#fff',
  glow: '#dc2626',
  glowLight: '#f87171',
  hint: '正在取消報名',
});

/** 可重繪的按鈕：模擬頁面依序改 running／settle／state。 */
function ringHarness(initial: Partial<EventDetailPrimaryButtonProps> = {}) {
  let props: EventDetailPrimaryButtonProps = {
    state: makeState(),
    disabled: false,
    busy: false,
    running: false,
    settle: { serial: 0, pending: false },
    onClick: () => {},
    ...initial,
  };
  const view = render(<EventDetailPrimaryButton {...props} />);
  return {
    view,
    update(next: Partial<EventDetailPrimaryButtonProps>): void {
      props = { ...props, ...next };
      view.rerender(<EventDetailPrimaryButton {...props} />);
    },
    button: (): HTMLButtonElement => view.container.querySelector('button') as HTMLButtonElement,
  };
}

function stubFrames() {
  let id = 0;
  const request = vi.fn((_callback: FrameRequestCallback) => ++id);
  const cancel = vi.fn((_handle: number) => {});
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return { request, cancel };
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('EventDetailPrimaryButton', () => {
  it('glow 結構照 A _glowWrap', () => {
    const { container } = renderButton();
    const wrap = container.querySelector('.signup-glow-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('.signup-glow-border')).not.toBeNull();
    expect(wrap?.querySelector('.signup-glow-shadow')).not.toBeNull();
    expect(wrap?.querySelector('.signup-flipper')).not.toBeNull();
    expect(wrap?.querySelector('.signup-loading-hint .mini-spinner')).not.toBeNull();
    expect(wrap?.querySelector('.signup-loading-hint .mini-text')?.textContent).toBe('報名中');
    expect(wrap?.querySelector('button.primary-btn')?.textContent).toContain('立即報名');
  });

  it('busy 時加 aria-busy、sr-only、loading 與報名中文字', () => {
    const { container } = renderButton({ busy: true });
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.textContent).toContain('報名中...');
    expect(container.querySelector('.fcb-sr-only')?.textContent).toBe('處理中');
    expect(container.querySelector('.signup-glow-wrap')?.classList.contains('loading')).toBe(true);
  });

  it('取消候補 busy 文字照 U-028', () => {
    const { container } = renderButton({
      state: makeState({
        kind: 'cancelWaitlist',
        label: '取消候補',
        bg: '#7c3aed',
        glow: '#7c3aed',
        glowLight: '#a78bfa',
        hint: '正在取消候補',
      }),
      busy: true,
    });
    expect(container.querySelector('button')?.textContent).toContain('取消候補中...');
  });

  // 測試同步更新：11-09 翻牌改進度環（站長核可 A＋B），原「flip 背面」案例改驗進度環各階段。
  it('進度環曲線：0.6 秒到 60%，之後慢爬、永遠不到 100%', () => {
    expect(ringPercent(0)).toBe(0);
    expect(ringPercent(300)).toBeCloseTo(30);
    expect(ringPercent(600)).toBeCloseTo(60);
    expect(ringPercent(2_100)).toBeGreaterThan(75);
    expect(ringPercent(10_000)).toBeLessThan(90);
    expect(ringPercent(60_000)).toBeLessThanOrEqual(90);
    expect(ringPercent(2_000)).toBeLessThan(ringPercent(3_000));
  });

  it('主按鈕動作進行中：縮成圓、畫進度環、aria-busy 與報名中標籤，拿掉文字與光跡', () => {
    stubFrames();
    const ring = ringHarness({ busy: true, running: true });
    const button = ring.button();
    expect(button.classList.contains('signup-ring-btn')).toBe(true);
    expect(button.classList.contains('is-collapsed')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('報名中...');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('');
    expect(button.querySelector('.signup-ring-arc')?.getAttribute('stroke-dasharray')).toBe('94.25');
    expect(ring.view.container.querySelector('.signup-glow-wrap')?.classList.contains('loading')).toBe(false);
  });

  it('取消類動作的環標籤是取消中', () => {
    stubFrames();
    const ring = ringHarness({ state: cancelState, busy: true, running: true });
    expect(ring.button().getAttribute('aria-label')).toBe('取消報名中...');
  });

  it('成功：等 settle 放行才補滿＋✓＋展開，最後才換新狀態文字，途中不露出任何狀態文字', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFrames();
    const ring = ringHarness({ busy: true, running: true });
    const seen: string[] = [];
    const record = (): void => { seen.push(ring.button().textContent ?? ''); };
    // 伺服器成功：頁面解除 busy、settle 進入 pending，背景重讀中狀態已先變（額滿投影）。
    ring.update({
      busy: false,
      running: false,
      settle: { serial: 1, pending: true },
      state: makeState({ kind: 'waitlist', label: '報名候補', variant: 'styled', bg: '#7c3aed' }),
    });
    record();
    expect(ring.button().classList.contains('is-collapsed')).toBe(true);
    // 環上凍結按下時的狀態，不閃中間狀態的底色。
    expect(ring.button().classList.contains('primary-btn')).toBe(true);
    act(() => { vi.advanceTimersByTime(5_000); });
    record();
    expect(ring.view.container.querySelector('.signup-ring-check')).toBeNull();
    // 重讀完成：資料已是新狀態才放行。
    ring.update({ settle: { serial: 1, pending: false }, state: cancelState });
    record();
    expect(ring.view.container.querySelector('.signup-ring-arc.is-fill')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(180); });
    record();
    expect(ring.view.container.querySelector('.signup-ring-check')?.textContent).toBe('✓');
    expect(ring.button().classList.contains('is-collapsed')).toBe(true);
    act(() => { vi.advanceTimersByTime(220); });
    record();
    expect(ring.button().classList.contains('is-collapsed')).toBe(false);
    expect(ring.button().classList.contains('signup-ring-btn')).toBe(true);
    expect(ring.view.container.querySelector('.signup-ring-check')).not.toBeNull();
    expect(seen.every(text => text === '' || text === '✓')).toBe(true);
    act(() => { vi.advanceTimersByTime(260); });
    expect(ring.button().textContent).toBe('取消報名');
    expect(ring.button().classList.contains('signup-ring-btn')).toBe(false);
    expect(ring.button().getAttribute('aria-busy')).toBeNull();
    expect(ring.button().getAttribute('aria-label')).toBeNull();
    expect(ring.button().disabled).toBe(false);
  });

  it('失敗：不打勾，直接展開回原狀態', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFrames();
    const ring = ringHarness({ busy: true, running: true });
    ring.update({ busy: false, running: false });
    expect(ring.view.container.querySelector('.signup-ring-check')).toBeNull();
    expect(ring.button().classList.contains('is-collapsed')).toBe(false);
    expect(ring.button().textContent).toBe('');
    act(() => { vi.advanceTimersByTime(260); });
    expect(ring.button().textContent).toBe('立即報名');
    expect(ring.button().classList.contains('signup-ring-btn')).toBe(false);
  });

  it('減少動態：不變形不畫環，靜態忙碌文字，結果出來直接切換', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const frames = stubFrames();
    stubReducedMotion(true);
    const ring = ringHarness({ busy: true, running: true });
    expect(ring.button().classList.contains('signup-ring-btn')).toBe(false);
    expect(ring.view.container.querySelector('svg')).toBeNull();
    expect(ring.button().textContent).toContain('報名中...');
    expect(ring.button().getAttribute('aria-busy')).toBe('true');
    expect(ring.view.container.querySelector('.signup-glow-wrap')?.classList.contains('loading')).toBe(true);
    ring.update({ busy: false, running: false, settle: { serial: 1, pending: true } });
    expect(ring.button().textContent).toContain('報名中...');
    ring.update({ settle: { serial: 1, pending: false }, state: cancelState });
    expect(ring.button().textContent).toBe('取消報名');
    expect(ring.button().getAttribute('aria-busy')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.request).not.toHaveBeenCalled();
  });

  it('其他動作造成的頁面忙碌不變形，沿用靜態忙碌樣式', () => {
    stubFrames();
    const ring = ringHarness({ busy: true });
    expect(ring.button().classList.contains('signup-ring-btn')).toBe(false);
    expect(ring.button().textContent).toContain('報名中...');
  });

  it('卸載時取消進度環的 requestAnimationFrame 與計時器', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const frames = stubFrames();
    const ring = ringHarness({ busy: true, running: true });
    expect(frames.request).toHaveBeenCalled();
    const lastFrame = frames.request.mock.results.at(-1)?.value;
    ring.view.unmount();
    expect(frames.cancel).toHaveBeenCalledWith(lastFrame);

    const second = ringHarness({ busy: true, running: true });
    second.update({ busy: false, running: false, settle: { serial: 1, pending: false } });
    expect(vi.getTimerCount()).toBe(1);
    second.view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('團隊報名按鈕：寫入中縮成環，成功才打勾後展開成新文字', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFrames();
    const team = {
      label: '團隊報名',
      busyLabel: '建立團隊名額中',
      busy: true,
      doneSerial: 0,
      onClick: () => {},
    };
    const ring = ringHarness({ teamReservation: team });
    const teamButton = (): HTMLButtonElement =>
      ring.view.container.querySelector('.event-signup-team-button') as HTMLButtonElement;
    // 測試同步更新：11-09 審查後團隊鈕延一個 0ms 才開始環（本地驗證失敗不閃），先推進 0ms。
    expect(teamButton().classList.contains('is-collapsed')).toBe(false);
    act(() => { vi.advanceTimersByTime(0); });
    expect(teamButton().classList.contains('is-collapsed')).toBe(true);
    expect(teamButton().getAttribute('aria-label')).toBe('建立團隊名額中');
    expect(teamButton().getAttribute('aria-busy')).toBe('true');
    ring.update({ teamReservation: { ...team, busy: false, doneSerial: 1, label: '調整名額' } });
    act(() => { vi.advanceTimersByTime(180); });
    expect(teamButton().querySelector('.signup-ring-check')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(480); });
    expect(teamButton().textContent).toBe('調整名額');
    expect(teamButton().classList.contains('signup-ring-btn')).toBe(false);
  });

  it('團隊報名失敗：不打勾直接展開', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFrames();
    const team = { label: '團隊報名', busyLabel: '建立團隊名額中', busy: true, onClick: () => {} };
    const ring = ringHarness({ teamReservation: team });
    // 測試同步更新：同上，先推進 0ms 讓環真的開始，再驗失敗不打勾。
    act(() => { vi.advanceTimersByTime(0); });
    expect(ring.view.container.querySelector('.event-signup-team-button.is-collapsed')).not.toBeNull();
    ring.update({ teamReservation: { ...team, busy: false } });
    const teamButton = ring.view.container.querySelector('.event-signup-team-button');
    expect(teamButton?.querySelector('.signup-ring-check')).toBeNull();
    act(() => { vi.advanceTimersByTime(260); });
    expect(ring.view.container.querySelector('.event-signup-team-button')?.textContent).toBe('團隊報名');
  });

  it('早鳥可報 DOM', () => {
    const { container } = renderButton({
      state: makeState({
        kind: 'earlyBird',
        label: '早鳥報名 · 50 積分',
        variant: 'earlyBird',
        action: 'earlyBird',
        glow: '#d97706',
        glowLight: '#fbbf24',
        hint: '早鳥報名中',
        glowWrap: true,
      }),
    });
    expect(container.querySelector('.signup-glow-wrap.event-early-bird-cta')).not.toBeNull();
    expect(container.querySelector('button.event-early-bird-btn')?.textContent)
      .toContain('早鳥報名 · 50 積分');
  });

  it('早鳥不可報 DOM', () => {
    const { container } = renderButton({
      state: makeState({
        kind: 'earlyBirdFull',
        label: '早鳥名額已滿',
        variant: 'earlyBird',
        disabled: true,
        action: 'none',
        glowWrap: false,
        subtext: '正式開放後可依活動狀態候補報名',
      }),
    });
    expect(container.querySelector('.signup-glow-wrap')).toBeNull();
    expect(container.querySelector('.event-early-bird-cta')).not.toBeNull();
    expect(container.querySelector('button.event-early-bird-btn-disabled')?.textContent)
      .toContain('早鳥名額已滿');
    expect(container.querySelector('.event-early-bird-subtext')?.textContent)
      .toBe('正式開放後可依活動狀態候補報名');
  });

  it('disabled 時不呼叫 onClick', () => {
    const onClick = vi.fn();
    const { container } = renderButton({ disabled: true, onClick });
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    if (button) fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('團隊報名本地檢查沒過（busy 同一輪就收回）：不縮圓、不閃展開', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubFrames();
    const team = { label: '團隊報名', busyLabel: '建立團隊名額中', busy: false, onClick: () => {} };
    const ring = ringHarness({ teamReservation: team });
    const teamButton = (): HTMLButtonElement =>
      ring.view.container.querySelector('.event-signup-team-button') as HTMLButtonElement;
    ring.update({ teamReservation: { ...team, busy: true } });
    expect(teamButton().classList.contains('signup-ring-btn')).toBe(false);
    ring.update({ teamReservation: { ...team, busy: false } });
    expect(teamButton().classList.contains('signup-ring-btn')).toBe(false);
    act(() => { vi.advanceTimersByTime(300); });
    expect(teamButton().classList.contains('signup-ring-btn')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(teamButton().textContent).toBe('團隊報名');
  });
});

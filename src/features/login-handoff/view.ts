// 轉交畫面的掛載點：各自建立一個 body 底下的容器，用 preact render；view＝null 時卸載並移除容器。
import { h, render, type VNode } from 'preact';
import { RelayScreen, WaitScreen } from './HandoffViews';
import type { RelayHandlers, RelayView, WaitHandlers, WaitView } from './view-types';

export type { RelayHandlers, RelayView, WaitHandlers, WaitView } from './view-types';

const hosts: { wait: HTMLElement | null; relay: HTMLElement | null } = { wait: null, relay: null };

function mount(slot: 'wait' | 'relay', vnode: VNode<any> | null): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof document === 'undefined') return;
  if (vnode === null) {
    const host = hosts[slot];
    if (!host) return;
    render(null, host);
    host.remove();
    hosts[slot] = null;
    return;
  }
  let host = hosts[slot];
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-login-handoff', slot);
    document.body.appendChild(host);
    hosts[slot] = host;
  }
  render(vnode, host);
}

/** view＝null 時卸載。可重複呼叫更新狀態。 */
export function renderWait(view: WaitView | null, handlers: WaitHandlers): void {
  mount('wait', view ? h(WaitScreen, { view, handlers }) : null);
}

export function renderRelay(view: RelayView | null, handlers: RelayHandlers): void {
  mount('relay', view ? h(RelayScreen, { view, handlers }) : null);
}

import './contact-fab-hint.css';
import { t } from '@/i18n/i18n';

/**
 * 聯繫站長浮球提示（延遲載入的 chunk；主程式只判斷要不要下載，見 ContactOwnerFab）。
 * 每次回到首頁都顯示。
 * - 浮球抖兩輪（每輪 1.6 秒、中間停 1.6 秒，共 4.8 秒；reduced motion 不抖），泡泡 6 秒後消失。
 * - 點泡泡＝點浮球（直接觸發浮球的 click，走浮球當下最新的 onClick）。
 * - 顯示中點泡泡以外任何地方就關閉（capture pointerdown，不攔截、不吞該次點擊）。
 * 浮球已卸下（下載期間離開首頁）就不顯示。回傳收尾函式，浮球卸下時由主程式呼叫，清掉計時器與泡泡。
 */
export function showContactFabHint(): (() => void) | undefined {
  const fab = document.querySelector<HTMLElement>('.contact-owner-fab');
  if (!fab?.isConnected) return undefined;

  const bubble = document.createElement('div');
  bubble.className = 'contact-owner-fab-hint';
  bubble.setAttribute('role', 'status');
  bubble.textContent = t('home.contactOwner.hint');

  const stopShake = (): void => fab.classList.remove('is-shaking');
  const onPointerDown = (e: Event): void => {
    if (!bubble.contains(e.target as Node)) close();
  };
  // 4.8 秒對齊 CSS 兩輪結束。不聽 animationend：兩段動畫各發一次，reduced motion 與 jsdom 也不保證會發。
  const timers = [setTimeout(stopShake, 4800), setTimeout(() => close(), 6000)];
  function close(): void {
    timers.forEach(clearTimeout);
    stopShake();
    bubble.remove();
    document.removeEventListener('pointerdown', onPointerDown, true);
  }
  bubble.addEventListener('click', () => {
    close();
    fab.click();
  });

  document.body.appendChild(bubble);
  if (!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    fab.classList.add('is-shaking');
  }
  document.addEventListener('pointerdown', onPointerDown, true);
  return close;
}

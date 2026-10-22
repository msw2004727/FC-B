// M-075：左右滑切頁籤，照 A `app.js#_bindSwipeTabs`（805-965）：
// 門檻 40px／速度 >0.3 且至少 20px、垂直捲動優先 dy>10、邊界阻尼 0.3、動畫曲線與 fallback 350ms 全部照 A。
// 可給之後「我的活動」頁共用：內容元素 ref、頁籤容器 ref、onSwitch(key)、getKey(btn)。
import { useEffect, useRef } from 'preact/hooks';

interface ElementRefLike {
  current: HTMLElement | null;
}

export interface UseSwipeTabsOptions {
  contentRef: ElementRefLike;
  tabsRef: ElementRefLike;
  /** 滑到下一頁時呼叫，傳入 getKey 回傳的 key（null 表示不切換） */
  onSwitch: (key: string) => void;
  /** 從按鈕取得頁籤 key；null 表示此鈕不參與滑動切換（例如未開放頁籤） */
  getKey: (btn: HTMLElement) => string | null;
}

export function useSwipeTabs(options: UseSwipeTabsOptions): void {
  const onSwitchRef = useRef(options.onSwitch);
  onSwitchRef.current = options.onSwitch;
  const getKeyRef = useRef(options.getKey);
  getKeyRef.current = options.getKey;

  const contentRef = options.contentRef;
  const tabsRef = options.tabsRef;

  useEffect(() => {
    const content = contentRef.current;
    const tabs = tabsRef.current;
    if (!content || !tabs) return;
    // 照 A：先用 dataset 擋重複綁定；SSR／測試環境缺 TouchEvent 也不拋錯
    if (content.dataset['swipeBound']) return;
    content.dataset['swipeBound'] = '1';

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let swiping = false;
    let locked = false;
    let animating = false;
    let contentW = 0;
    const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

    const reset = (): void => {
      content.style.transition = '';
      content.style.transform = '';
      content.style.opacity = '';
      content.style.willChange = '';
    };

    const onTransitionEnd = (cb: () => void): void => {
      let called = false;
      const handler = (): void => {
        if (called) return;
        called = true;
        content.removeEventListener('transitionend', handler);
        if (pendingTimers.has(fallback)) {
          clearTimeout(fallback);
          pendingTimers.delete(fallback);
        }
        cb();
      };
      content.addEventListener('transitionend', handler);
      const fallback = setTimeout(handler, 350);
      pendingTimers.add(fallback);
    };

    const getButtons = (): HTMLElement[] =>
      Array.from(tabs.querySelectorAll<HTMLElement>('button'));

    const findActiveIdx = (list: HTMLElement[]): number =>
      list.findIndex((b) => b.classList.contains('active'));

    const handleTouchStart = (e: TouchEvent): void => {
      if (animating) return;
      const touch = e.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      swiping = false;
      locked = false;
      contentW = content.offsetWidth;
      content.style.transition = 'none';
      content.style.willChange = 'transform, opacity';
    };

    const handleTouchMove = (e: TouchEvent): void => {
      if (locked || animating) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!swiping) {
        // 垂直捲動優先：dy 超過 10 且大於 dx → 鎖定為垂直、不攔截
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
          locked = true;
          return;
        }
        if (Math.abs(dx) > 10) swiping = true;
        else return;
      }

      if (e.cancelable) e.preventDefault();

      const buttons = getButtons();
      const activeIdx = findActiveIdx(buttons);
      let ratio = dx / (contentW || 1);
      // 邊界阻尼：第一頁往右拖、最後一頁往左拖
      if ((activeIdx <= 0 && dx > 0) || (activeIdx >= buttons.length - 1 && dx < 0)) {
        ratio *= 0.3;
      }
      content.style.transform = `translateX(${ratio * 100}%)`;
      content.style.opacity = String(Math.max(1 - Math.abs(ratio) * 0.4, 0.5));
    };

    const handleTouchEnd = (e: TouchEvent): void => {
      content.style.willChange = '';
      if (!swiping || locked || animating) {
        content.style.transition = '';
        content.style.transform = '';
        content.style.opacity = '';
        return;
      }
      const touch = e.changedTouches[0];
      if (!touch) {
        reset();
        return;
      }
      const dx = touch.clientX - startX;
      const elapsed = Date.now() - startTime;
      const velocity = Math.abs(dx) / (elapsed || 1);

      const buttons = getButtons();
      if (buttons.length < 2) {
        reset();
        return;
      }
      const activeIdx = findActiveIdx(buttons);
      if (activeIdx < 0) {
        reset();
        return;
      }

      // 照 A：40px 距離或速度 >0.3 px/ms 且至少 20px
      const shouldSwitch = Math.abs(dx) >= 40 || (Math.abs(dx) >= 20 && velocity > 0.3);
      const nextIdx = dx < 0
        ? Math.min(activeIdx + 1, buttons.length - 1)
        : Math.max(activeIdx - 1, 0);

      if (!shouldSwitch || nextIdx === activeIdx) {
        // 彈回原位
        content.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1), opacity .25s ease';
        content.style.transform = 'translateX(0)';
        content.style.opacity = '1';
        onTransitionEnd(() => reset());
        return;
      }

      // 滑出動畫
      animating = true;
      const exitDir = dx < 0 ? '-100%' : '100%';
      const enterFrom = dx < 0 ? '40%' : '-40%';

      content.style.transition = 'transform .2s cubic-bezier(.4,0,1,1), opacity .18s ease';
      content.style.transform = `translateX(${exitDir})`;
      content.style.opacity = '0';

      onTransitionEnd(() => {
        const btn = buttons[nextIdx];
        const key = btn ? getKeyRef.current(btn) : null;
        if (key != null && btn) {
          content.style.transition = 'none';
          content.style.transform = `translateX(${enterFrom})`;
          content.style.opacity = '0';

          onSwitchRef.current(key);

          // 強制 reflow 後啟動滑入動畫
          void content.offsetWidth;

          content.style.transition = 'transform .25s cubic-bezier(.0,0,.2,1), opacity .2s ease';
          content.style.transform = 'translateX(0)';
          content.style.opacity = '1';

          onTransitionEnd(() => {
            reset();
            animating = false;
          });

          if (typeof btn.scrollIntoView === 'function') {
            btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        } else {
          reset();
          animating = false;
        }
      });
    };

    content.addEventListener('touchstart', handleTouchStart, { passive: true });
    content.addEventListener('touchmove', handleTouchMove, { passive: false });
    content.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      content.removeEventListener('touchstart', handleTouchStart);
      content.removeEventListener('touchmove', handleTouchMove);
      content.removeEventListener('touchend', handleTouchEnd);
      for (const t of pendingTimers) clearTimeout(t);
      pendingTimers.clear();
      delete content.dataset['swipeBound'];
    };
  }, [contentRef, tabsRef]);
}

import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { ROUTE_LOAD_FAILED_MSG } from '@/core/unavailable';
import { toast } from '@/ui/Toast';
import type { SideDrawerProps } from '@/ui/SideDrawer';

export type SideDrawerComponent = typeof import('@/ui/SideDrawer').SideDrawer;

type SideDrawerImporter = () => Promise<{ SideDrawer: SideDrawerComponent }>;

const importSideDrawer: SideDrawerImporter = () => import('@/ui/SideDrawer');
let importer = importSideDrawer;
let loading: Promise<SideDrawerComponent> | null = null;
let loaded: SideDrawerComponent | null = null;

/**
 * 側邊選單（含選單設定、PWA 安裝教學框、隱身切換）的延遲載入。首屏只畫關閉狀態，
 * 所以不放進首頁主程式；App 第一次畫完就開始下載，下載完立刻掛上（關閉狀態），使用者點選單時通常已備妥。
 * 本檔不得靜態 import SideDrawer 或 drawer-menu。
 */
export function loadSideDrawer(): Promise<SideDrawerComponent> {
  if (!loading) {
    const promise = importer().then((mod) => {
      loaded = mod.SideDrawer;
      return mod.SideDrawer;
    });
    loading = promise;
    promise.catch(() => {
      if (loading === promise) loading = null;
    });
  }
  return loading;
}

/** 測試用：清掉快取；可換掉下載函式（模擬下載慢或失敗），不傳就恢復原本的。 */
export function _resetSideDrawerLoaderForTest(next?: SideDrawerImporter): void {
  importer = next ?? importSideDrawer;
  loading = null;
  loaded = null;
}

interface BodyLock {
  count: number;
  value: string;
  priority: string;
}

// 與 SideDrawer 的 lockBody 同一套（inline overflow + 計數，最後一次才還原），不要另加 body class。
// 那個 WeakMap 沒有 export，這裡是獨立計數：佔位鎖必須在真的 Drawer 的 useLayoutEffect 上鎖之前解除，
// 否則對方會把「已經被改成 hidden」記成原本的值，關掉後背景仍鎖住，或佔位解鎖時把對方提前解開。
const bodyLocks = new WeakMap<HTMLElement, BodyLock>();

function lockBody(body: HTMLElement): () => void {
  let lock = bodyLocks.get(body);
  if (!lock) {
    lock = {
      count: 0,
      value: body.style.getPropertyValue('overflow'),
      priority: body.style.getPropertyPriority('overflow'),
    };
    bodyLocks.set(body, lock);
    body.style.setProperty('overflow', 'hidden');
  }
  lock.count += 1;
  return () => {
    const current = bodyLocks.get(body);
    if (!current) return;
    current.count -= 1;
    if (current.count !== 0) return;
    if (current.value) {
      body.style.setProperty('overflow', current.value, current.priority);
    } else {
      body.style.removeProperty('overflow');
    }
    bodyLocks.delete(body);
  };
}

export function LazySideDrawer(props: SideDrawerProps): JSX.Element | null {
  const [Drawer, setDrawer] = useState<SideDrawerComponent | null>(() => loaded);
  const [failed, setFailed] = useState(false);
  const { path } = useLocation();
  const openRef = useRef(props.open);
  const onCloseRef = useRef(props.onClose);
  const pathRef = useRef(path);
  // 真的 Drawer 已經 commit 過才算它接手換頁。和「這次 render 才拿到 Drawer」分開，
  // 否則換頁與下載完成落在同一批時，Drawer 已非 null 會跳過關閉。
  const drawerCommittedRef = useRef(false);
  const navCancelledRef = useRef(false);
  const closeForPathRef = useRef<string | null>(null);
  const prevOpenRenderRef = useRef(props.open);
  const unlockBodyRef = useRef<(() => void) | null>(null);
  const restoreFocusRef = useRef(false);
  onCloseRef.current = props.onClose;

  const opening = props.open && !prevOpenRenderRef.current;
  prevOpenRenderRef.current = props.open;
  if (opening) {
    navCancelledRef.current = false;
    closeForPathRef.current = null;
  }

  // 換頁當下這次 render 就作廢「選單還沒掛上」的那次開啟，不等 parent 把 open 改成 false。
  // 下載失敗的 handler 讀的是 openRef，這裡先清掉才不會在新頁面跳出載入失敗 toast。
  if (pathRef.current !== path) {
    pathRef.current = path;
    if (!drawerCommittedRef.current && props.open && !opening) {
      navCancelledRef.current = true;
    }
  }

  const sessionOpen = props.open && !navCancelledRef.current;
  openRef.current = sessionOpen;
  // 佔位關掉才還焦點。交給已開啟的 SideDrawer 時不還，避免把它剛放上面板的焦點搶回來。
  restoreFocusRef.current = !sessionOpen;

  const releasePlaceholderLock = (): void => {
    const unlock = unlockBodyRef.current;
    if (!unlock) return;
    unlockBodyRef.current = null;
    unlock();
  };

  // 子元件的 useLayoutEffect 比父元件早。真的 Drawer 要上鎖、或佔位結束時，
  // 得在這次 render 就先還原 overflow，SideDrawer 才讀得到佔位之前的值，也不會被稍後的 cleanup 提前解開。
  if (Drawer || !sessionOpen) releasePlaceholderLock();

  useEffect(() => {
    if (Drawer || failed) return undefined;
    let alive = true;
    loadSideDrawer().then(
      (component) => {
        if (alive) setDrawer(() => component);
      },
      (err: unknown) => {
        if (!alive) return;
        console.error('[drawer] 載入側邊選單失敗', err);
        setFailed(true);
        // 使用者正在等選單打開：照換頁載入失敗的提示，並把選單狀態收回（再點一次會重試）。
        // 換頁已取消的那次開啟 openRef 是 false，不再提示。
        if (openRef.current) {
          toast.show({ message: ROUTE_LOAD_FAILED_MSG, tone: 'error' });
          onCloseRef.current();
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [Drawer, failed]);

  // 下載失敗後使用者再點選單（由關變開）：重新下載。
  const prevOpenRef = useRef(props.open);
  useEffect(() => {
    const becameOpen = props.open && !prevOpenRef.current;
    prevOpenRef.current = props.open;
    if (becameOpen && failed) setFailed(false);
  }, [props.open, failed]);

  useLayoutEffect(() => {
    drawerCommittedRef.current = Drawer != null;
  }, [Drawer]);

  // 選單還沒 commit 就換頁：請 parent 把 open 收回。這次 render 已經用 sessionOpen=false 畫了，
  // 所以即使 parent 還沒跟上，也不會以開啟狀態掛上。選單掛上之後換頁仍由 SideDrawer 自己關。
  useEffect(() => {
    if (!navCancelledRef.current || !props.open) return;
    if (closeForPathRef.current === path) return;
    closeForPathRef.current = path;
    onCloseRef.current();
  }, [path, props.open]);

  // 只在「開著、但 Drawer 還沒下載完」這段補 Esc、捲動鎖、關閉後還焦點。
  // 焦點沿用 SideDrawer：returnFocusRef 優先，否則還給打開前的 activeElement。不做焦點陷阱、也不做左滑。
  useLayoutEffect(() => {
    if (Drawer || !sessionOpen || typeof document === 'undefined') return undefined;

    const previous = document.activeElement;
    const trigger = props.returnFocusRef?.current
      ?? (previous instanceof HTMLElement ? previous : null);

    if (!unlockBodyRef.current) unlockBodyRef.current = lockBody(document.body);

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      releasePlaceholderLock();
      if (restoreFocusRef.current && trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [Drawer, sessionOpen]);

  if (Drawer) {
    // 等待期間已顯示遮罩時直接以開啟狀態掛上：遮罩接續不閃，選單直接出現（不再滑入）。
    // 換頁取消時 sessionOpen 為 false，同一批即使 Drawer 剛到也不會開著出現。
    return <Drawer {...props} open={sessionOpen} />;
  }
  if (!sessionOpen || typeof document === 'undefined') return null;
  // 下載中按了選單：先蓋上和選單同一個遮罩（#drawer-overlay，樣式在首屏 layout.css），
  // 讓使用者知道有按到、也不會點到底下的頁面；點遮罩可取消。
  return createPortal(
    <div class="legacy-ui legacy-chrome">
      <div id="drawer-overlay" class="open" onClick={() => onCloseRef.current()} />
    </div>,
    document.body,
  );
}

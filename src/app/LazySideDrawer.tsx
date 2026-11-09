import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
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

export function LazySideDrawer(props: SideDrawerProps): JSX.Element | null {
  const [Drawer, setDrawer] = useState<SideDrawerComponent | null>(() => loaded);
  const [failed, setFailed] = useState(false);
  // 下載完時選單若已是「開」：先以關閉狀態掛上一次再打開，滑入動畫才和原本一樣。
  const [armed, setArmed] = useState(() => loaded !== null);
  const openRef = useRef(props.open);
  const onCloseRef = useRef(props.onClose);
  openRef.current = props.open;
  onCloseRef.current = props.onClose;

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
    const opening = props.open && !prevOpenRef.current;
    prevOpenRef.current = props.open;
    if (opening && failed) setFailed(false);
  }, [props.open, failed]);

  useLayoutEffect(() => {
    if (!Drawer || armed) return;
    // 先讓瀏覽器算出關閉狀態的樣式，之後加上 open 才會有轉場。
    void document.getElementById('side-drawer')?.offsetWidth;
    setArmed(true);
  }, [Drawer, armed]);

  if (!Drawer) return null;
  return <Drawer {...props} open={props.open && armed} />;
}

import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
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

export function LazySideDrawer(props: SideDrawerProps): JSX.Element | null {
  const [Drawer, setDrawer] = useState<SideDrawerComponent | null>(() => loaded);
  const [failed, setFailed] = useState(false);
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

  // 選單還沒下載完時換頁：照選單本身「換頁就關」的規則收回，下載完才不會在新頁面滑出來
  // （選單掛上後由 SideDrawer 自己處理換頁）。
  const { path } = useLocation();
  const pathRef = useRef(path);
  useEffect(() => {
    if (pathRef.current === path) return;
    pathRef.current = path;
    if (!Drawer && openRef.current) onCloseRef.current();
  }, [path, Drawer]);

  if (Drawer) {
    // 等待期間已顯示遮罩時直接以開啟狀態掛上：遮罩接續不閃，選單直接出現（不再滑入）。
    return <Drawer {...props} />;
  }
  if (!props.open || typeof document === 'undefined') return null;
  // 下載中按了選單：先蓋上和選單同一個遮罩（#drawer-overlay，樣式在首屏 layout.css），
  // 讓使用者知道有按到、也不會點到底下的頁面；點遮罩可取消。
  return createPortal(
    <div class="legacy-ui legacy-chrome">
      <div id="drawer-overlay" class="open" onClick={() => onCloseRef.current()} />
    </div>,
    document.body,
  );
}

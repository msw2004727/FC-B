// 賽事分享（CP-SHARE）預覽：正式詳情頁＋記憶體假資料。不連 Firestore、不呼叫 Functions、不載 LINE SDK。
// ?screen=detail|detail-live|sheet|sheet-nopicker|sheet-event|sheet-event-nopicker|flex 與 ?theme=light|dark。畫完設 window.__CPS_READY。
// 分享選單直接用 showShareActionSheet 打開（正式頁按鈕走同一支）；Flex 卡片用簡化的 Flex 繪製，和活動卡並排。
import { render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
// 與 main.tsx 相同的 A 全域樣式（分享選單是 A 外觀、掛在 .legacy-ui 裡）；搭配 vite.cp-share.config.ts 的 legacyCssScope。
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '@/styles/category-tokens.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { ToastHost } from '@/ui/ToastHost';
import { showShareActionSheet } from '@/features/events/components/legacy/ShareActionSheet';
import { buildEventFlexMessage, buildEventLiffUrl } from '@/features/events/data/event-share-builders';
import { CpEnvProvider, type CpInjectedEnv } from '@/features/competitions/env';
import { loadCompetitionsDict, makeCompetitionsT } from '@/features/competitions/i18n';
import { buildCompetitionFlexMessage, buildCompetitionLiffUrl, shareSheetLabels } from '@/features/competitions/data/competition-share';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import { createFakeCpRepo } from '@/features/competitions/testing/fake-cp-repo';
import { NOW, screenEnv } from '@/features/competitions/testing/screen-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'detail';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

export const SHARE_SCREENS = ['detail', 'detail-live', 'sheet', 'sheet-nopicker', 'sheet-event', 'sheet-event-nopicker', 'flex'] as const;

// 假的合格格式 id（cp_＋20 碼），不是任何真實賽事。
const CID = 'cp_DEMOdemoDEMOdemo0001';
// 封面示意：Storage 網址形狀（卡片 JSON 照正式判斷），畫面上換成本機示意圖。
const FAKE_COVER = 'https://firebasestorage.googleapis.com/v0/b/demo/o/images%2Fcompetitions%2Fc_demo%2Fcover.webp?alt=media';
const COVER_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="450"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>'
  + '<rect width="1200" height="450" fill="url(#g)"/><text x="600" y="250" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">封面示意 1200×450</text></svg>',
);

function envOf(screen: string): CpInjectedEnv {
  const base = screenEnv(screen === 'detail-live' ? 'real-live' : 'real-recruit');
  const bundle = base.bundle;
  if (!bundle?.competition) throw new Error('fixture');
  return {
    ...base,
    repo: createFakeCpRepo(),
    route: { cid: CID },
    bundle: { ...bundle, competition: { ...bundle.competition, id: CID, name: '2027 春季社區足球聯賽' } },
  };
}

function Detail({ screen }: { screen: string }): JSX.Element {
  return (
    <CpEnvProvider value={envOf(screen)}>
      <CompetitionDetailPage />
    </CpEnvProvider>
  );
}

// ---- 簡化 Flex 繪製（只畫這兩張卡會用到的屬性；尺寸照 LINE mega 泡泡約 300px 寬） ----
type Node = Record<string, unknown> & { type: string };
const SIZE: Record<string, string> = { xs: '13px', sm: '14px', md: '16px', lg: '19px' };
const GAP: Record<string, string> = { sm: '4px', md: '8px', lg: '12px' };
// Preact 會把 undefined 的樣式鍵設成空字串，蓋掉前面的 padding 簡寫：先濾掉。
function clean(style: Record<string, unknown>): JSX.CSSProperties {
  return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) as JSX.CSSProperties;
}
function localImage(url: string): string {
  if (url.startsWith('https://firebasestorage.googleapis.com/')) return COVER_SVG;
  return url.replace(/^https:\/\/toosterx\.com/, '');
}
function FlexNode({ node, horizontal }: { node: Node; horizontal?: boolean }): JSX.Element | null {
  const margin = typeof node.margin === 'string' ? GAP[node.margin] : undefined;
  const flex = typeof node.flex === 'number' ? (node.flex === 0 ? '0 0 auto' : `${node.flex} 1 0`) : (horizontal ? '1 1 0' : undefined);
  if (node.type === 'text') {
    return (
      <div style={clean({
        fontSize: SIZE[String(node.size)] ?? '14px',
        color: (node.color as string) ?? '#111',
        fontWeight: node.weight === 'bold' ? 700 : 400,
        textAlign: (node.align as string) ?? 'left',
        whiteSpace: node.wrap ? 'normal' : 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        lineHeight: 1.4,
        marginTop: horizontal ? undefined : margin,
        marginLeft: horizontal ? margin : undefined,
        flex,
        minWidth: 0,
      })}>{String(node.text)}</div>
    );
  }
  if (node.type === 'button') {
    const action = node.action as { label: string };
    return (
      <div style={{ background: node.color as string, color: '#fff', borderRadius: '6px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700 }}>
        {action.label}
      </div>
    );
  }
  if (node.type === 'box') {
    const row = node.layout === 'horizontal';
    const kids = (node.contents as Node[]) ?? [];
    const spacing = typeof node.spacing === 'string' ? GAP[node.spacing] : undefined;
    return (
      <div style={clean({
        display: 'flex',
        flexDirection: row ? 'row' : 'column',
        gap: spacing,
        background: node.backgroundColor as string | undefined,
        borderRadius: node.cornerRadius as string | undefined,
        padding: node.paddingAll as string | undefined,
        paddingLeft: node.paddingStart as string | undefined,
        paddingRight: node.paddingEnd as string | undefined,
        width: node.width as string | undefined,
        marginTop: margin,
        flex,
        boxSizing: 'border-box',
      })}>
        {kids.map((kid, i) => <FlexNode key={i} node={kid} horizontal={row} />)}
      </div>
    );
  }
  return null;
}
function Bubble({ bubble, caption }: { bubble: Record<string, unknown>; caption: string }): JSX.Element {
  const hero = bubble.hero as { url: string; aspectRatio: string } | undefined;
  const [w, h] = (hero?.aspectRatio ?? '1:1').split(':').map(Number);
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
      <div style={{ width: '300px', background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.15)', fontFamily: 'system-ui, sans-serif' }}>
        {hero ? <img src={localImage(hero.url)} alt="" style={{ display: 'block', width: '100%', aspectRatio: `${w} / ${h}`, objectFit: 'cover' }} /> : null}
        <FlexNode node={bubble.body as Node} />
        <FlexNode node={bubble.footer as Node} />
      </div>
      <figcaption style={{ fontSize: '13px', color: theme === 'dark' ? '#cbd5e1' : '#334155' }}>{caption}</figcaption>
    </figure>
  );
}

function FlexBoard({ dict }: { dict: Record<string, string> }): JSX.Element {
  const ct = makeCompetitionsT(dict);
  const comp = envOf('detail').bundle!.competition!;
  const url = buildCompetitionLiffUrl(CID);
  const recruiting = buildCompetitionFlexMessage(comp, url, ct, NOW);
  const withCover = buildCompetitionFlexMessage({ ...comp, category: 'cup', status: 'postponed', name: '2027 新北五人制盃賽', cover: { url: FAKE_COVER, thumb: FAKE_COVER } }, url, ct, NOW);
  const event = buildEventFlexMessage({ id: 'demo', title: '週六早場足球', date: '2027/01/09 08:00', location: '示範球場', type: 'play', sportTag: 'football', max: 20, current: 12 }, buildEventLiffUrl('demo'), { sharedAt: NOW });
  return (
    <div style={{ minHeight: '100vh', background: theme === 'dark' ? '#1f2937' : '#8cabd9', padding: '24px 16px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center', alignItems: 'flex-start' }}>
        <Bubble bubble={recruiting as unknown as Record<string, unknown>} caption="賽事卡：招募中、沒封面（足球預設圖）" />
        <Bubble bubble={withCover as unknown as Record<string, unknown>} caption="賽事卡：盃賽、有封面、已延期（列狀態、不列報名截止）" />
        <Bubble bubble={event as unknown as Record<string, unknown>} caption="對照：現行活動卡" />
      </div>
    </div>
  );
}

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

async function until(label: string, ready: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`畫面未出現：${label}`);
}

void start();

async function start(): Promise<void> {
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  try {
    if (!(SHARE_SCREENS as readonly string[]).includes(screenName)) throw new Error(`沒有這個 screen：${screenName}`);
    await setLocale('zh-TW');
    const dict = await loadCompetitionsDict('zh-TW');
    const root = document.getElementById('app');
    if (!root) return;
    // Flex 卡片板不放進 app 外框（外框限寬，1280 才能三張並排）。
    const body: ComponentChildren = screenName === 'flex' ? <FlexBoard dict={dict} /> : (
      <div class="app-shell ui-app-shell">
        <main class="app-main"><Detail screen={screenName} /></main>
      </div>
    );
    render(
      <LocationProvider>
        {body}
        <ToastHost />
      </LocationProvider>,
      root,
    );
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    if (screenName === 'flex') {
      await until('卡片', () => hasText('查看賽事'));
    } else {
      await until('分享鈕', () => hasText('分享賽事'));
      if (screenName.startsWith('sheet')) {
        const ct = makeCompetitionsT(dict);
        const picker = !screenName.endsWith('nopicker');
        // sheet-event*：活動分享的呼叫方式（不傳標題與文案，用元件預設中文）。
        if (screenName.startsWith('sheet-event')) void showShareActionSheet(picker, new AbortController().signal);
        else void showShareActionSheet(picker, new AbortController().signal, ct('shareBtn'), shareSheetLabels(ct));
        await until('分享選單', () => document.querySelector('.share-action-sheet.active') != null);
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}

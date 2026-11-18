// 側邊抽屜每一列的專屬圖示（DRAWER-GLASS）。路徑照預覽 icons.js：24 格、stroke 2、圓角端點。
// 鍵是 entry.page 或 entry.action。inline path，不引新套件（抽屜 chunk，不進首頁入口）。
import type { DrawerMenuEntry } from './drawer-menu';

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
} as const;

type IconSeg =
  | { readonly t: 'path'; readonly d: string }
  | { readonly t: 'circle'; readonly cx: string; readonly cy: string; readonly r: string }
  | { readonly t: 'rect'; readonly x: string; readonly y: string; readonly width: string; readonly height: string; readonly rx?: string };

const path = (d: string): IconSeg => ({ t: 'path', d });
const circle = (cx: string, cy: string, r: string): IconSeg => ({ t: 'circle', cx, cy, r });
const rect = (x: string, y: string, width: string, height: string, rx?: string): IconSeg => (
  { t: 'rect', x, y, width, height, rx }
);

const ICONS: Readonly<Record<string, readonly IconSeg[]>> = {
  'page-personal-dashboard': [
    path('M4 20h16'),
    path('M7 16v-5'),
    path('M12 16V6'),
    path('M17 16v-8'),
  ],
  'coming-soon': [
    path('M8 4h8v5a4 4 0 0 1-8 0z'),
    path('M8 6H5.5a2.5 2.5 0 0 0 2.6 4'),
    path('M16 6h2.5a2.5 2.5 0 0 1-2.6 4'),
    path('M12 13v4'),
    path('M8.5 20h7'),
    path('M10 17h4'),
  ],
  manual: [
    path('M3 5.5c2.7-1 5.7-.8 9 1 3.3-1.8 6.3-2 9-1V19c-2.7-1-5.7-.8-9 1-3.3-1.8-6.3-2-9-1z'),
    path('M12 6.5V20'),
  ],
  share: [
    circle('18', '5.5', '2.5'),
    circle('6', '12', '2.5'),
    circle('18', '18.5', '2.5'),
    path('M8.2 10.8l7.6-4.1'),
    path('M8.2 13.2l7.6 4.1'),
  ],
  'apply-role': [
    circle('9', '8', '3.5'),
    path('M3 20c.8-3.4 3.2-5 6-5s5.2 1.6 6 5'),
    path('M19 8v6'),
    path('M16 11h6'),
  ],
  'page-my-activities': [
    rect('3', '5', '18', '16', '2'),
    path('M3 10h18'),
    path('M8 3v4'),
    path('M16 3v4'),
    path('M9 15.5l2 2 4-4'),
  ],
  'page-team-manage': [
    circle('9', '8', '3'),
    path('M3 19c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5'),
    circle('17', '9', '2.5'),
    path('M16.5 14.6c2.3.2 4 1.6 4.5 4.4'),
  ],
  'page-admin-users': [
    circle('10', '8', '3.5'),
    path('M3 20c.8-3.4 3.2-5 7-5 1 0 1.9.1 2.7.4'),
    circle('18', '17', '2.3'),
    path('M18 13.2v1.5M18 19.3v1.5M14.2 17h1.5M20.3 17h1.5'),
  ],
  'page-admin-banners': [
    rect('3', '4', '18', '16', '2'),
    path('M3 15.5l5-5 4 4 3-3 6 6'),
    circle('16', '8.5', '1.5'),
  ],
  'page-admin-messages': [
    rect('3', '5', '18', '14', '2'),
    path('M3.5 6.5L12 13l8.5-6.5'),
  ],
  'page-admin-repair': [
    circle('12', '12', '8.5'),
    path('M6 6l12 12'),
  ],
  'page-admin-dashboard': [
    path('M3.5 17a8.5 8.5 0 1 1 17 0'),
    path('M12 17l4-5'),
    circle('12', '17', '1.3'),
    path('M7 7.8l1 1.2M17 7.8l-1 1.2M12 5.5V7'),
  ],
  'page-admin-notif': [
    path('M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10z'),
    path('M10 20a2 2 0 0 0 4 0'),
  ],
  'page-admin-announcements': [
    path('M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z'),
    path('M16.5 9.5a3.5 3.5 0 0 1 0 5'),
    path('M19 7a7 7 0 0 1 0 10'),
  ],
  'page-admin-roles': [
    path('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'),
    path('M9 12l2 2 4-4'),
  ],
  'page-admin-logs': [
    rect('5', '3', '14', '18', '2'),
    path('M9 8h6'),
    path('M9 12h6'),
    path('M9 16h4'),
  ],
  'page-admin-inactive': [
    circle('11', '11', '6.5'),
    path('M16 16l4.5 4.5'),
    path('M9 9l4 4'),
    path('M13 9l-4 4'),
  ],
};

export const DRAWER_MENU_ICON_KEYS: readonly string[] = Object.keys(ICONS);

export function drawerMenuIconKey(entry: Pick<DrawerMenuEntry, 'page' | 'action'>): string {
  return entry.page || entry.action || '';
}

export function DrawerMenuIcon({ page, action }: { page?: string; action?: string }): preact.JSX.Element | null {
  const segs = ICONS[page || action || ''];
  if (!segs) return null;
  return (
    <span class="dg-ico" aria-hidden="true">
      <svg {...svgProps}>
        {segs.map((seg, index) => {
          if (seg.t === 'path') return <path key={index} d={seg.d} />;
          if (seg.t === 'circle') return <circle key={index} cx={seg.cx} cy={seg.cy} r={seg.r} />;
          return <rect key={index} x={seg.x} y={seg.y} width={seg.width} height={seg.height} rx={seg.rx} />;
        })}
      </svg>
    </span>
  );
}

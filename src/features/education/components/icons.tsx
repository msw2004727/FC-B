import type { JSX } from 'preact';

function Svg({ children, small }: { children: JSX.Element | JSX.Element[]; small?: boolean }): JSX.Element {
  return (
    <svg class={small ? 'ck-ico ck-ico-sm' : 'ck-ico'} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconBack(): JSX.Element {
  return <Svg><polyline points="15 18 9 12 15 6" /></Svg>;
}

export function IconClock(): JSX.Element {
  return (
    <Svg small>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </Svg>
  );
}

export function IconPin(): JSX.Element {
  return (
    <Svg small>
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  );
}

export function IconPlus(): JSX.Element {
  return (
    <Svg small>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function IconDown({ open }: { open: boolean }): JSX.Element {
  return <Svg small>{open ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}</Svg>;
}

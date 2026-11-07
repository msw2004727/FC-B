/**
 * 出席名單名字欄的同行分組（B2 連線樹）。只看實際渲染順序，不讀寫 Firestore。
 *
 * 標頭、一般報名分隔、保留席位都是 solo，會打斷「緊接」：連線不跨這些列。
 * 主報名人仍在同一份名單裡找，所以分隊打散時首字還在、connected 為 false。
 */

import type { ConfirmedRosterPerson } from './attendance-roster-model';

/** 組色順序：accent → 領隊 → 場主 → 隊長，第 5 組回到 0。 */
export const COMPANION_GROUP_COLOR_VARS = [
  'var(--accent)',
  'var(--color-role-captain)',
  'var(--color-role-venue)',
  'var(--color-role-lead)',
] as const;

export type CompanionRowMeta =
  | { kind: 'solo'; slot: 0 }
  | { kind: 'lead'; slot: number; mateCount: number }
  | { kind: 'proxyLead'; slot: number; mateCount: number }
  | {
    kind: 'mate';
    slot: number;
    ownerInitial: string;
    connected: boolean;
    last: boolean;
    dashed: boolean;
  };

export function companionGroupColorVar(slot: number): string {
  const index = ((Math.floor(slot) % 4) + 4) % 4;
  return COMPANION_GROUP_COLOR_VARS[index] ?? COMPANION_GROUP_COLOR_VARS[0];
}

function soloMeta(): CompanionRowMeta {
  return { kind: 'solo', slot: 0 };
}

/** 第一個字；英文 a–z 轉大寫。沒有字（空字串或空白）回 `?`。 */
export function ownerInitial(name: string | null | undefined): string {
  const ch = Array.from(name ?? '')[0];
  if (!ch || !ch.trim()) return '?';
  if (ch >= 'a' && ch <= 'z') return String.fromCharCode(ch.charCodeAt(0) - 32);
  return ch;
}

function isStructural(row: ConfirmedRosterPerson): boolean {
  return Boolean(row.isTeamHeader || row.isTeamGeneralSeparator || row.isTeamPlaceholder);
}

function isProxyLead(row: ConfirmedRosterPerson): boolean {
  return Boolean(row.proxyOnly || row.isProxyOnly);
}

/** 緊接在後面、ownerUid 等於這列 uid 的同行者數。中間插了別人就停。 */
function immediateMateCount(rows: readonly ConfirmedRosterPerson[], index: number, ownerUid: string): number {
  if (!ownerUid) return 0;
  let count = 0;
  for (let j = index + 1; j < rows.length; j += 1) {
    const next = rows[j];
    if (!next?.isCompanion || next.ownerUid !== ownerUid) break;
    count += 1;
  }
  return count;
}

export function buildCompanionRowMeta(rows: readonly ConfirmedRosterPerson[]): CompanionRowMeta[] {
  const metas: CompanionRowMeta[] = rows.map(() => soloMeta());
  let nextSlot = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.isCompanion || isStructural(row)) continue;
    if (isProxyLead(row)) {
      const slot = nextSlot % 4;
      nextSlot += 1;
      metas[i] = { kind: 'proxyLead', slot, mateCount: immediateMateCount(rows, i, row.uid) };
      continue;
    }
    if (row.hasSelfReg) {
      const mateCount = immediateMateCount(rows, i, row.uid);
      if (mateCount > 0) {
        const slot = nextSlot % 4;
        nextSlot += 1;
        metas[i] = { kind: 'lead', slot, mateCount };
      }
    }
  }

  const ownerAt = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.isCompanion || isStructural(row) || !row.uid || ownerAt.has(row.uid)) return;
    ownerAt.set(row.uid, index);
  });

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row?.isCompanion) continue;
    const ownerIdx = row.ownerUid ? ownerAt.get(row.ownerUid) : undefined;
    if (ownerIdx === undefined) {
      metas[i] = {
        kind: 'mate', slot: 0, ownerInitial: '?', connected: false, last: false, dashed: false,
      };
      continue;
    }
    const owner = rows[ownerIdx];
    const ownerMeta = metas[ownerIdx];
    if (!owner || !ownerMeta) continue;
    const grouped = ownerMeta.kind === 'lead' || ownerMeta.kind === 'proxyLead';
    const prev = i > 0 ? rows[i - 1] : undefined;
    const prevMeta = i > 0 ? metas[i - 1] : undefined;
    // 只從同 owner 的 lead／proxyLead 沿相鄰同行者往下接；中間被別人打斷就不再連。
    const connected = Boolean(prev && prevMeta && (
      ((prevMeta.kind === 'lead' || prevMeta.kind === 'proxyLead') && prev.uid === row.ownerUid)
      || (prevMeta.kind === 'mate' && prevMeta.connected && prev.ownerUid === row.ownerUid)
    ));
    metas[i] = {
      kind: 'mate',
      slot: grouped ? ownerMeta.slot : 0,
      ownerInitial: ownerInitial(owner.displayName),
      connected,
      last: false,
      dashed: ownerMeta.kind === 'proxyLead',
    };
  }

  for (let i = 0; i < rows.length; i += 1) {
    const meta = metas[i];
    if (!meta || meta.kind !== 'mate') continue;
    if (!meta.connected) {
      meta.last = false;
      continue;
    }
    const next = metas[i + 1];
    const nextRow = rows[i + 1];
    const continues = next?.kind === 'mate' && next.connected && nextRow?.ownerUid === rows[i]?.ownerUid;
    meta.last = !continues;
  }

  return metas;
}

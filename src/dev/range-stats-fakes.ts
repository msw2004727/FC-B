// 活動區間統計 harness 的假讀取層（簽名同 src/features/events/data/range-stats.ts）。不連 Firestore。
import type { DateRangeKeys, EventRoster } from '@/features/events/data/range-stats-model';
import type { EventDoc } from '@/features/events/data/types';

function rand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export async function loadRangeEvents(range: DateRangeKeys): Promise<EventDoc[]> {
  const r = rand(range.startKey.split('/').reduce((a, b) => a * 31 + Number(b), 7));
  const count = Math.max(1, Math.round(range.days * 1.25));
  const start = Date.UTC(Number(range.startKey.slice(0, 4)), Number(range.startKey.slice(5, 7)) - 1, Number(range.startKey.slice(8, 10)));
  const out: EventDoc[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start + Math.floor(r() * range.days) * 86_400_000);
    const date = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} 19:00~21:00`;
    const x = r();
    const status = x < 0.06 ? 'cancelled' : x < 0.12 ? 'upcoming' : 'ended';
    out.push({ id: `p${i}`, _docId: `d${i}`, title: `活動${i}`, date, status } as EventDoc);
  }
  return out;
}

export async function loadRangeRosters(
  events: readonly EventDoc[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ rosters: EventRoster[]; failed: EventDoc[] }> {
  const r = rand(events.length * 17 + 3);
  const rosters = events.map((event, i) => {
    const regs = [];
    const att = [];
    const n = 12 + Math.floor(r() * 10);
    for (let k = 0; k < n; k += 1) {
      const uid = `u${Math.floor(r() * 160)}`;
      const y = r();
      const status = y < 0.08 ? 'cancelled' : y < 0.15 ? 'waitlisted' : 'confirmed';
      regs.push({ userId: uid, status });
      if (status === 'confirmed' && event.status === 'ended') {
        const z = r();
        if (z < 0.82) att.push({ uid, type: 'checkin' }, { uid, type: 'checkout' });
        else if (z < 0.86) att.push({ uid, type: 'checkin' });
      }
    }
    onProgress?.(i + 1, events.length);
    return { event, registrations: regs, attendance: att };
  });
  return { rosters, failed: [] };
}

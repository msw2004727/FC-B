// 觀眾監聽。onSnapshot 只放這支，不放進 cp-repo（那邊的測試鎖住沒有 onSnapshot）。
// 可見時才由頁面呼叫。本檔不自己看 visibility。

import type { QueryDocumentSnapshot } from 'firebase/firestore';
import type { VoidMark } from '../live/types';
import {
  audienceMatchFromDoc,
  pageLoop,
  parseStats,
  parseTimelineDoc,
  parseVoidDoc,
  type AudiencePorts,
  type ParsedTimeline,
} from './audience';
import { getCpFirebase } from './cp-firebase';
import { summaryEntriesFromDoc } from './cp-repo';

function isSafeId(id: string): boolean {
  return id.length > 0 && !id.includes('/') && id !== '.' && id !== '..';
}

async function open() {
  const [{ db }, sdk] = await Promise.all([
    getCpFirebase(),
    import('firebase/firestore'),
  ]);
  return { db, sdk };
}

function emptyLog(): { events: ParsedTimeline[]; voids: VoidMark[]; reads: number } {
  return { events: [], voids: [], reads: 0 };
}

/** 正式頁用。測試注入 AudiencePorts，不走這裡。 */
export function createAudiencePorts(): AudiencePorts {
  return {
    watchSummary({ cid, shardId }, onRows) {
      if (!isSafeId(cid) || !isSafeId(shardId)) {
        onRows([]);
        return () => {};
      }
      let unsub = (): void => {};
      let dead = false;
      void open().then(({ db, sdk }) => {
        if (dead) return;
        unsub = sdk.onSnapshot(sdk.doc(db, `competitions/${cid}/summary/${shardId}`), (snap) => {
          const data = snap.data();
          onRows(data ? summaryEntriesFromDoc(data) : []);
        }, () => {
          // 摘要讀不到就留著目前列表。
        });
      }).catch(() => {
        // 連不上就留著一次讀取的結果。
      });
      return () => {
        dead = true;
        unsub();
      };
    },

    watchMatch({ cid, mtId }, onMatch) {
      if (!isSafeId(cid) || !isSafeId(mtId)) {
        onMatch({ kind: 'missing' });
        return () => {};
      }
      let unsub = (): void => {};
      let dead = false;
      void open().then(({ db, sdk }) => {
        if (dead) return;
        unsub = sdk.onSnapshot(sdk.doc(db, `competitions/${cid}/matches/${mtId}`), (snap) => {
          if (!snap.exists()) {
            onMatch({ kind: 'missing' });
            return;
          }
          const match = audienceMatchFromDoc(snap.id, snap.data() ?? {});
          onMatch(match ? { kind: 'ok', match } : { kind: 'missing' });
        }, () => {
          onMatch({ kind: 'missing' });
        });
      }).catch(() => {
        if (!dead) onMatch({ kind: 'missing' });
      });
      return () => {
        dead = true;
        unsub();
      };
    },

    async readLog(input) {
      if (!isSafeId(input.cid) || !isSafeId(input.mtId)) return emptyLog();
      const { db, sdk } = await open();
      const base = `competitions/${input.cid}/matches/${input.mtId}`;
      const timeline = sdk.collection(db, `${base}/timeline`);
      const voidCol = sdk.collection(db, `${base}/voids`);
      const fetchPage = (col: ReturnType<typeof sdk.collection>) => (
        async (page: { afterSeq: number; limit: number; cursor: QueryDocumentSnapshot | null }) => {
          const q = page.cursor
            ? sdk.query(col, sdk.where('seq', '>', page.afterSeq), sdk.orderBy('seq'), sdk.startAfter(page.cursor), sdk.limit(page.limit))
            : sdk.query(col, sdk.where('seq', '>', page.afterSeq), sdk.orderBy('seq'), sdk.limit(page.limit));
          const snap = await sdk.getDocs(q);
          return snap.docs;
        }
      );
      const events = await pageLoop(fetchPage(timeline), input.afterEvents, input.alreadyEvents);
      const voids = await pageLoop(fetchPage(voidCol), input.afterVoids, input.alreadyVoids);
      return {
        events: events.rows
          .map((doc) => parseTimelineDoc(doc.data() ?? {}))
          .filter((row): row is ParsedTimeline => row != null),
        voids: voids.rows
          .map((doc) => parseVoidDoc(doc.id, doc.data() ?? {}))
          .filter((row): row is VoidMark => row != null),
        reads: events.reads + voids.reads,
      };
    },

    async getStats(cid, dvId) {
      if (!isSafeId(cid) || !isSafeId(dvId)) return parseStats(null);
      const { db, sdk } = await open();
      const snap = await sdk.getDoc(sdk.doc(db, `competitions/${cid}/stats/${dvId}`));
      return parseStats(snap.exists() ? snap.data() : null);
    },
  };
}

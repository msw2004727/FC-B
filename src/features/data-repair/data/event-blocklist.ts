import { arrayRemove, arrayUnion, doc, runTransaction } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { eventDoc, resolveEventDocId } from '@/data/paths';
import { assertAllowedFields } from '@/data/write-guard';
import {
  blockedUsers, canWriteEventBlocklist, isValidBlocklistUid,
  type BlocklistEvent, type BlocklistLog, type BlocklistUser, type BlocklistViewer,
} from './event-blocklist-model';
import { EventBlocklistGuardError } from './event-blocklist-errors';
import { recordBlocklistOpLog } from './event-blocklist-oplog';

export const EVENT_BLOCKLIST_FIELDS = ['blockedUids', 'blockedUidsLog'] as const;
export interface ChangeBlocklistInput {
  viewer: BlocklistViewer;
  event: BlocklistEvent;
  uid: string;
  action: 'add' | 'remove';
  reason?: string;
  users: readonly BlocklistUser[];
}
export interface ChangeBlocklistResult { changed: boolean; event: BlocklistEvent }

export async function changeEventBlocklist(input: ChangeBlocklistInput): Promise<ChangeBlocklistResult> {
  const { viewer, event, uid, action, users } = input;
  if (!canWriteEventBlocklist(viewer)) throw new EventBlocklistGuardError('permission-denied');
  if (!isValidBlocklistUid(uid)) throw new EventBlocklistGuardError('INVALID_UID');
  if (event.courseLinked === true) throw new EventBlocklistGuardError('COURSE_LINKED');
  const target = users.find(user => user.uid === uid);
  if (action === 'add' && !target) throw new EventBlocklistGuardError('USER_MISSING');
  const docId = event._docId || (event.id ? await resolveEventDocId(event.id) : null);
  if (!docId || docId.includes('/')) throw new EventBlocklistGuardError('EVENT_MISSING');
  const { db, auth } = await getFirebase();
  if (!auth.currentUser || auth.currentUser.uid !== viewer.uid) throw new EventBlocklistGuardError('permission-denied');
  const actorUid = auth.currentUser.uid;
  const ref = doc(db, eventDoc(docId));
  const result = await runTransaction(db, async tx => {
    if (auth.currentUser?.uid !== actorUid) throw new EventBlocklistGuardError('permission-denied');
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new EventBlocklistGuardError('EVENT_MISSING');
    const current: BlocklistEvent = { ...snap.data(), _docId: docId };
    if (current.courseLinked === true) throw new EventBlocklistGuardError('COURSE_LINKED');
    const blocked = blockedUsers(current);
    if (blocked.includes(uid) === (action === 'add')) return { changed: false, event: current };
    const entry: BlocklistLog = {
      uid, by: actorUid, action, at: new Date().toISOString(),
      reason: action === 'add' ? (input.reason || '').trim().slice(0, 80) : '',
    };
    const payload = {
      blockedUids: action === 'add' ? arrayUnion(uid) : arrayRemove(uid),
      blockedUidsLog: arrayUnion(entry),
    };
    assertAllowedFields('eventBlocklist', payload, EVENT_BLOCKLIST_FIELDS);
    tx.update(ref, payload);
    const original = Array.isArray(current.blockedUids) ? current.blockedUids : [];
    return { changed: true, event: {
      ...current,
      blockedUids: action === 'add' ? [...original, uid] : original.filter(value => value !== uid),
      blockedUidsLog: [...(Array.isArray(current.blockedUidsLog) ? current.blockedUidsLog : []), entry],
    } };
  });
  if (result.changed) void recordBlocklistOpLog(viewer, result.event, action, target?.name || '未命名');
  return result;
}

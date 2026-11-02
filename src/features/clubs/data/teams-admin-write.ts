/**
 * 俱樂部管理頁的寫入（K2 置頂／上下架／光跡、K5 刪除）。
 *
 * 對應 A `js/modules/team/team-list.js` 的 `toggleTeamPin`、`toggleTeamActive`、
 * `toggleTeamAttentionEffect`、`changeTeamAttentionEffectColor`、`removeTeam`。
 *
 * - 置頂／上下架／光跡：前端直寫 `teams`（Rules `canManageAnyTeam()` 放行），欄位照 A，另帶 `updatedAt`（A `updateTeam` 也會帶）。
 *   成功後就地更新快取（不重讀整集合），再 best-effort 寫一筆 `operationLogs`（`actorUid`＝自己）。
 * - 刪除：只走 Callable `deleteTeam`（伺服器清成員隊籍、重算角色、最後才刪文件；可重入）。
 *   A 是前端先刪文件再逐一清成員並吞錯（既有缺點），B 不照搬。
 * - 權限判斷不在本檔做；呼叫端以 club-policy 同一判斷決定按鈕顯示與 handler（R-IAM-011）。
 */

import { getFirebase } from '@/data/firebase';
import { teams as teamsCollection } from '@/data/paths';
import type { DeleteTeamResponse } from '@/data/contract/callables';
import { patchCachedTeam, removeCachedTeam } from './teams-repo';
import type { TeamDoc } from './types';

export type TeamAdminTarget = Pick<TeamDoc, 'id' | '_docId' | 'name'>;

/** A `_normalizeTeamAttentionColor` 的預設色。 */
export const DEFAULT_ATTENTION_COLOR = '#fbbf24';

/** A `_normalizeTeamAttentionColor`。 */
export function normalizeTeamAttentionColor(value: unknown): string {
  const raw = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : DEFAULT_ATTENTION_COLOR;
}

/**
 * A `_getNextTeamPinOrder`：已載入清單的最大 pinOrder + 1，且不小於 100（A `_pinCounter` 起始值）。
 * 不另讀資料；多管理員同時置頂可能同號（A 同樣行為，只影響顯示順序）。
 */
export function getNextTeamPinOrder(teams: readonly TeamDoc[]): number {
  const maxOrder = teams.reduce((max, team) => {
    const value = Number(team?.pinOrder || 0);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
  return Math.max(100, maxOrder + 1);
}

function resolveDocId(team: TeamAdminTarget): string {
  const docId = String(team?._docId ?? '').trim();
  const id = String(team?.id ?? '').trim();
  if (!docId && !id) throw new Error('[teams-admin-write] team doc id missing');
  return docId || id;
}

async function updateTeamFields(team: TeamAdminTarget, fields: Partial<TeamDoc>): Promise<void> {
  const docId = resolveDocId(team);
  const [firestore, { db }] = await Promise.all([import('firebase/firestore'), getFirebase()]);
  await firestore.updateDoc(firestore.doc(db, teamsCollection, docId), {
    ...fields,
    updatedAt: firestore.serverTimestamp(),
  });
  patchCachedTeam(docId, fields);
  const publicId = String(team.id ?? '').trim();
  if (publicId && publicId !== docId) patchCachedTeam(publicId, fields);
}

export interface TeamAdminActor {
  uid: string | null;
  displayName?: string | null;
}

async function writeTeamOpLog(
  actor: TeamAdminActor,
  type: string,
  typeName: string,
  content: string,
): Promise<void> {
  try {
    const { writeOpLog } = await import('@/data/op-log');
    await writeOpLog({
      type,
      typeName,
      content,
      actorUid: actor.uid,
      operator: actor.displayName?.trim() || '系統',
    });
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[teams-admin-write] writeOpLog failed');
  }
}

/** A `toggleTeamPin`：置頂時取下一個 pinOrder，取消時 pinOrder 歸 0。回傳寫入的欄位。 */
export async function saveTeamPinned(
  team: TeamAdminTarget,
  pinned: boolean,
  loadedTeams: readonly TeamDoc[],
  actor: TeamAdminActor,
): Promise<{ pinned: boolean; pinOrder: number }> {
  const updates = { pinned, pinOrder: pinned ? getNextTeamPinOrder(loadedTeams) : 0 };
  await updateTeamFields(team, updates);
  const name = team.name || resolveDocId(team);
  await writeTeamOpLog(actor, 'team_pin', '俱樂部置頂', `${pinned ? '置頂' : '取消置頂'}「${name}」`);
  return updates;
}

/**
 * A `toggleTeamActive` 的 B 版：等寫入完成才回報成功，失敗往外拋由呼叫端回滾畫面
 * （A 是樂觀更新、不 await、失敗不回滾，屬 A 既有缺點）。
 * 與 A 刻意差異：A 上下架不寫操作日誌，B 照計畫補一筆 `team_active`（站長要求可稽核，只多 1 筆寫入）。
 */
export async function saveTeamActive(
  team: TeamAdminTarget,
  active: boolean,
  actor: TeamAdminActor,
): Promise<void> {
  await updateTeamFields(team, { active });
  const name = team.name || resolveDocId(team);
  await writeTeamOpLog(actor, 'team_active', '俱樂部上下架', `${active ? '上架' : '下架'}「${name}」`);
}

/** A `toggleTeamAttentionEffect`：開關時一併寫正規化後的顏色。 */
export async function saveTeamAttentionEnabled(
  team: TeamAdminTarget,
  enabled: boolean,
  currentColor: unknown,
  actor: TeamAdminActor,
): Promise<void> {
  const color = normalizeTeamAttentionColor(currentColor);
  await updateTeamFields(team, { attentionEffectEnabled: enabled, attentionEffectColor: color });
  const name = team.name || resolveDocId(team);
  await writeTeamOpLog(actor, 'team_attention_effect', '光跡效果', `將「${name}」光跡效果${enabled ? '開啟' : '關閉'}`);
}

/** A `changeTeamAttentionEffectColor`。回傳實際寫入的顏色。 */
export async function saveTeamAttentionColor(
  team: TeamAdminTarget,
  colorValue: unknown,
  previousColor: unknown,
  actor: TeamAdminActor,
): Promise<string> {
  const previous = normalizeTeamAttentionColor(previousColor);
  const raw = String(colorValue ?? '').trim();
  const next = /^#[0-9a-f]{6}$/i.test(raw) ? raw : previous;
  await updateTeamFields(team, { attentionEffectColor: next });
  const name = team.name || resolveDocId(team);
  await writeTeamOpLog(actor, 'team_attention_effect_color', '光跡顏色', `更新「${name}」光跡顏色`);
  return next;
}

export type DeleteTeamResult =
  | { status: 'deleted'; roleChangedUids: string[] }
  | { status: 'partial'; remaining: number };

/**
 * Callable `deleteTeam`。成功（含 alreadyDeleted）就從快取移除該隊；partial 表示有成員清不掉、
 * 俱樂部仍保留，呼叫端提示再按一次。錯誤往外拋（CallableError）。
 */
export async function deleteTeamViaCallable(team: TeamAdminTarget): Promise<DeleteTeamResult> {
  const teamId = String(team.id ?? '').trim() || resolveDocId(team);
  const { callFn } = await import('@/data/callables');
  // 伺服器上限 120 秒，前端多留 5 秒，避免 SDK 預設 70 秒先逾時而誤報失敗
  const res: DeleteTeamResponse = await callFn('deleteTeam', { teamId }, { timeout: 125000 });
  if (res?.partial) {
    return { status: 'partial', remaining: Number(res.partial.remaining) || 0 };
  }
  removeCachedTeam(resolveDocId(team));
  if (teamId) removeCachedTeam(teamId);
  const roleChangedUids = Array.isArray(res?.roleChangedUids)
    ? res.roleChangedUids.map((uid) => String(uid ?? '').trim()).filter(Boolean)
    : [];
  return { status: 'deleted', roleChangedUids };
}

/** 伺服器錯誤訊息碼 → A 風格提示；未知錯誤回 A `removeTeam` 的通用失敗文案。 */
export function getTeamAdminErrorMessage(error: unknown, fallback: string): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  if (message.includes('COACH_PLUS_REQUIRED')) return '權限不足';
  if (message.includes('TEAM_DELETE_DENIED') || message.includes('TEAM_MANAGE_DENIED')) return '權限不足';
  // 伺服器拒絕文件 id 與 id 欄位不一致的舊格式俱樂部；重試無效，不叫人重試
  if (message.includes('TEAM_ID_MISMATCH')) return '此俱樂部資料格式較舊，請聯繫管理員處理';
  return fallback;
}

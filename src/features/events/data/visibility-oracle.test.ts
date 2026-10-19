/**
 * FC 真實函式產生的差分測試。
 *
 * 僅 adapter 使用 fixture；正式實作不得依案例 ID 或 expected 分支。
 * 未在本次回覆環境執行 TypeScript / Vitest，也未讀取完整 300 案。
 * 不宣稱已全數通過；目前沒有足以確認 drift / R-ID-002 違規的案例，
 * 因此不跳過任何案例。
 */

import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/visibility-oracle.json';
import type { EventDoc, RegistrationDoc, ViewerContext } from './types';
import {
  canListPrivateEvent,
  getVisibleEvents,
  isEventVisibleToUser,
} from './visibility';
import {
  computeVisibleTeamIds,
  getPrivateListRoleLevel,
  type VisibilityTeamDoc,
  type VisibilityUserDoc,
} from '../../profile/data/viewer-visibility';

interface OracleEvent {
  id: string;
  blockedUids: unknown;
  privateEvent: boolean;
  teamOnly: boolean;
  creatorTeamIds: unknown;
  creatorTeamId: string | null;
  isPublic: boolean;
  creatorUid: string | null;
  ownerUid: string | null;
  captainUid: string | null;
  delegateUids: string[];
}

interface OracleInput {
  viewer: { uid: string | null };
  role: string;
  customRoles?: { key: string; label: string; afterRole: string }[];
  userDoc: (VisibilityUserDoc & { role?: string }) | null;
  teams: VisibilityTeamDoc[];
  event: OracleEvent;
  viewerRegistrations: {
    eventId: string;
    uid: string;
    status: string;
  }[];
}

interface OracleCase {
  id: string;
  input: OracleInput;
  expected: {
    isEventVisibleToUser: boolean;
    visibleTeamIds: string[];
    canListPrivateEvent: boolean;
    visibleInList: boolean;
  };
}

/** 使用型別檢查，不以斷言掩蓋 fixture shape 不相容。 */
const cases: readonly OracleCase[] = fixture.cases;

/**
 * A 可空字串欄位在 B 的讀取型別中是 optional string。
 * 將 null 轉為欄位不存在，保留非 null 字串（包括空白）原值。
 * 這些欄位在可見性函式中對 null / undefined 有相同處理。
 */
function toEvent(input: OracleEvent): EventDoc {
  const {
    creatorTeamId,
    creatorUid,
    ownerUid,
    captainUid,
    ...rest
  } = input;

  return {
    ...rest,
    ...(creatorTeamId === null ? {} : { creatorTeamId }),
    ...(creatorUid === null ? {} : { creatorUid }),
    ...(ownerUid === null ? {} : { ownerUid }),
    ...(captainUid === null ? {} : { captainUid }),
  };
}

/**
 * 嚴格重建 generator 的 stub：
 * getCurrentUserEffectivePermissions 未提供，A 使用 getRolePermissions。
 * stub 僅讓 admin / super_admin 取得 event.edit_all。
 * 這是測試環境映射，並非 B 正式權限規則或 admin 全可見。
 */
function oracleHasPermission(role: string, code: string): boolean {
  return code === 'event.edit_all'
    && (role === 'admin' || role === 'super_admin');
}

describe('FC visibility oracle', () => {
  it('包含完整且 ID 唯一的 302 案（含自訂角色私密列表 2 案）', () => {
    expect(fixture.meta.caseCount).toBe(302);
    expect(cases).toHaveLength(fixture.meta.caseCount);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
  });

  for (const entry of cases) {
    const summary = JSON.stringify(entry.input);
    const message = `${entry.id} input=${summary}`;

    it(message, () => {
      const { input, expected } = entry;

      // A _getCurrentActivityRoleKey 優先 currentUser.role，再用 currentRole。
      const privateRole = input.userDoc?.role || input.role || 'user';
      const currentUserUid = typeof input.userDoc?.uid === 'string'
        ? input.userDoc.uid
        : null;

      const teamIds = computeVisibleTeamIds(
        currentUserUid,
        input.userDoc,
        input.teams,
      );

      const viewer: ViewerContext = {
        uid: currentUserUid,
        teamIds,
        roleLevel: getPrivateListRoleLevel(privateRole, input.customRoles),
        hasPermission: (code) => oracleHasPermission(input.role, code),
      };

      // _isEventVisibleToUser 的直接呼叫使用 input.viewer.uid；
      // _canListPrivateEvent / _getVisibleEvents 使用 currentUser。
      const blocklistViewer: ViewerContext = {
        ...viewer,
        uid: input.viewer.uid,
      };

      // 不先按觀看者過濾，不丟棄 cancelled / removed；
      // 由正式函式精確比對 eventId 與 canonical userId。
      const registrations: RegistrationDoc[] = input.viewerRegistrations.map(
        (registration) => ({
          eventId: registration.eventId,
          userId: registration.uid,
          status: registration.status,
        }),
      );

      const event = toEvent(input.event);
      const visibleEvents = getVisibleEvents([event], viewer, registrations);

      expect({
        isEventVisibleToUser: isEventVisibleToUser(
          event,
          blocklistViewer,
          registrations,
        ),
        visibleTeamIds: [...teamIds].sort(),
        canListPrivateEvent: canListPrivateEvent(event, viewer),
        visibleInList: visibleEvents.length === 1
          && visibleEvents[0]?.id === event.id,
      }, message).toEqual({
        ...expected,
        visibleTeamIds: [...expected.visibleTeamIds].sort(),
      });
    });
  }

  it('leaderUids 陣列優先，包含空陣列；不與 leaderUid 聯集', () => {
    const user = { uid: 'u1' };
    expect([...computeVisibleTeamIds('u1', user, [
      { id: 'empty', leaderUids: [], leaderUid: 'u1' },
      { id: 'other', leaderUids: ['u2'], leaderUid: 'u1' },
      { id: 'legacy', leaderUid: 'u1' },
      { id: 'array', leaderUids: ['u1'], leaderUid: 'u2' },
    ])].sort()).toEqual(['array', 'legacy']);
  });
});

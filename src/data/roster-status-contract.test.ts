import { describe, expect, expectTypeOf, it } from 'vitest';
import { ROSTER_STATUS_CALLABLES_DEPLOYED } from './roster-status-deployed';
import { CALLABLES } from './contract/callables';
import type {
  ForceDemoteToWaitlistRequest, ForceDemoteToWaitlistResponse,
  ForcePromoteWaitlistRequest, ForcePromoteWaitlistResponse,
  RosterStatusDedupedResponse,
} from './contract/callables';
import type { CallableMap, RequestOf, ResponseOf } from './callables';
describe('名單狀態調整契約', () => {
  it('旗標現值鎖定', () => { expect(ROSTER_STATUS_CALLABLES_DEPLOYED).toBe(true); });
  it('兩支登錄與 region', () => {
    for (const name of ['forceDemoteToWaitlist', 'forcePromoteWaitlist'] as const) {
      expect(CALLABLES[name]).toMatchObject({ region: 'asia-east1', auth: 'required' });
    }
  });
  it('request 與 response 的精確型別及窄化', () => {
    expectTypeOf<RequestOf<'forceDemoteToWaitlist'>>().toEqualTypeOf<ForceDemoteToWaitlistRequest>();
    expectTypeOf<RequestOf<'forcePromoteWaitlist'>>().toEqualTypeOf<ForcePromoteWaitlistRequest>();
    expectTypeOf<ResponseOf<'forceDemoteToWaitlist'>>().toEqualTypeOf<ForceDemoteToWaitlistResponse>();
    expectTypeOf<CallableMap['forcePromoteWaitlist']['res']>().toEqualTypeOf<ForcePromoteWaitlistResponse>();
    expectTypeOf<ForceDemoteToWaitlistRequest>().toEqualTypeOf<{
      eventId: string; userId: string; registrationId?: string; requestId?: string;
    }>();
    expectTypeOf<ForcePromoteWaitlistRequest>().toMatchTypeOf<{
      eventId: string; userId: string; registrationId?: string; requestId?: string; allowOverCapacity?: boolean;
    }>();
    function narrow(response: ForceDemoteToWaitlistResponse | ForcePromoteWaitlistResponse) {
      if ('deduplicated' in response) {
        expectTypeOf(response).toEqualTypeOf<RosterStatusDedupedResponse>();
        // @ts-expect-error 名單狀態調整：此分支沒有投影欄位。
        response.event;
      } else {
        expectTypeOf(response.current).toEqualTypeOf<number>();
        expectTypeOf(response.event.realCurrent).toEqualTypeOf<number>();
      }
    }
    narrow({ success: true, deduplicated: true });
  });
});

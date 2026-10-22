import { useEffect, useRef, useState } from 'preact/hooks';
import { lt } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { DelegationEntry, EventForEdit } from '../../data/event-create';
import { operateContextFromViewer } from '../../data/event-create-context';
import { canManageEventDelegates } from '../../data/operate-permissions';
import {
  getUserDirectory,
  loadUserDirectory,
  searchUserDirectory,
  verifyUserDirectorySelection,
  type DirectoryUser,
  type DirectoryVerification,
} from '../../data/user-directory';
import type { DelegateChip, DelegatePickerView } from './form-types';

// 照 A `_eventCreateDelegateTimeoutMs: 12000`（event-create.js:27）。
const DELEGATE_TIMEOUT_MS = 12_000;

type SubmitResult = { ok: true } | { ok: false; message: string };
type VerificationOutcome =
  | { kind: 'result'; result: DirectoryVerification }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'error' };

export function useDelegatePicker(input: {
  viewer: ViewerView;
  existing: EventForEdit | null;
}): {
  view: DelegatePickerView;
  value: DelegationEntry[];
  reset(initial: DelegationEntry[]): void;
  verifyForSubmit(): Promise<SubmitResult>;
} {
  const [, redraw] = useState(0);
  const latest = useRef(input);
  latest.current = input;
  const alive = useRef(true);
  const session = useRef(0);
  const searchSeq = useRef(0);
  const submitSeq = useRef(0);
  const selected = useRef<DelegationEntry[]>([]);
  const query = useRef('');
  const results = useRef<DelegateChip[]>([]);
  const open = useRef(false);
  const focusedOnce = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancellations = useRef(new Set<() => void>());
  const identity = JSON.stringify([
    input.viewer.uid,
    input.existing?.id ?? null,
    input.existing?.docId ?? null,
  ]);
  const previousIdentity = useRef(identity);

  const permitted = (): boolean =>
    canManageEventDelegates(
      operateContextFromViewer(latest.current.viewer),
      latest.current.existing,
    );

  const render = (): void => {
    if (alive.current) redraw(value => value + 1);
  };

  const clearBlur = (): void => {
    if (blurTimer.current !== null) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  };

  const cancelVerifications = (): void => {
    for (const cancel of [...cancellations.current]) cancel();
  };

  // 照 A formSession；舊帳號／舊活動的回應不得回寫目前表單。
  if (previousIdentity.current !== identity) {
    previousIdentity.current = identity;
    session.current += 1;
    searchSeq.current += 1;
    submitSeq.current += 1;
    selected.current = [];
    query.current = '';
    results.current = [];
    open.current = false;
    focusedOnce.current = false;
    clearBlur();
    cancelVerifications();
  }

  const directoryName = (user: DirectoryUser): string =>
    user.displayName.trim() || user.name.trim() || user.uid.trim();

  const matching = (value: string): DelegateChip[] =>
    searchUserDirectory(
      getUserDirectory(),
      value,
      [latest.current.viewer.uid ?? '', ...selected.current.map(item => item.uid)],
    ).map(user => ({ uid: user.uid, name: directoryName(user), role: user.role || 'user' }));

  const search = async (force: boolean): Promise<void> => {
    const requestSession = session.current;
    const requestSeq = ++searchSeq.current;
    const requestedQuery = query.current.trim().toLowerCase();
    if (!permitted() || selected.current.length >= 3) {
      results.current = [];
      open.current = false;
      render();
      return;
    }

    results.current = requestedQuery ? matching(requestedQuery) : [];
    open.current = Boolean(requestedQuery);
    render();

    try {
      await loadUserDirectory({ force });
    } catch {
      // 照 A _searchDelegates；載入失敗仍保留可用的快取結果。
    }
    if (
      !alive.current
      || session.current !== requestSession
      || searchSeq.current !== requestSeq
      || query.current.trim().toLowerCase() !== requestedQuery
      || !permitted()
    ) return;

    results.current = requestedQuery ? matching(requestedQuery) : [];
    open.current = Boolean(requestedQuery) && selected.current.length < 3;
    render();
  };

  useEffect(() => {
    alive.current = true;
    // 照 A _initDelegateSearch；既定 view 沒有 onBlur，使用 A 固定 input id。
    const onFocusOut = (event: FocusEvent): void => {
      if (!(event.target instanceof HTMLElement) || event.target.id !== 'ce-delegate-search') return;
      clearBlur();
      blurTimer.current = setTimeout(() => {
        blurTimer.current = null;
        if (!alive.current) return;
        searchSeq.current += 1;
        open.current = false;
        render();
      }, 200);
    };
    document.addEventListener('focusout', onFocusOut);
    return () => {
      alive.current = false;
      session.current += 1;
      searchSeq.current += 1;
      submitSeq.current += 1;
      clearBlur();
      cancelVerifications();
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const reset = (initial: DelegationEntry[]): void => {
    if (!alive.current) return;
    session.current += 1;
    searchSeq.current += 1;
    submitSeq.current += 1;
    clearBlur();
    cancelVerifications();
    const seen = new Set<string>();
    selected.current = initial.flatMap(item => {
      const uid = item.uid.trim();
      if (!uid || uid === latest.current.viewer.uid || seen.has(uid) || seen.size >= 3) return [];
      seen.add(uid);
      return [{ uid, name: item.name.trim() }];
    });
    query.current = '';
    results.current = [];
    open.current = false;
    focusedOnce.current = false;
    render();
    if (permitted()) {
      // 照 A _initDelegateSearch，開表單先強制更新目錄；之後首次 focus 不再重複 force（Gemini 審 P3）。
      focusedOnce.current = true;
      search(true).catch(() => undefined);
    }
  };

  const pick = async (rawUid: string): Promise<void> => {
    const uid = rawUid.trim();
    if (!alive.current || !uid) return;
    if (!permitted()) {
      toast.show(lt('權限不足', '權限不足'));
      return;
    }
    if (
      uid === latest.current.viewer.uid
      || selected.current.length >= 3
      || selected.current.some(item => item.uid === uid)
    ) return;

    const requestSession = session.current;
    const requestSeq = searchSeq.current;
    const requestedQuery = query.current.trim().toLowerCase();
    let verification: DirectoryVerification;
    try {
      verification = await verifyUserDirectorySelection([uid]);
    } catch {
      verification = { ok: false, users: [], missingUids: [uid], reason: 'unavailable' };
    }

    if (
      !alive.current
      || requestSession !== session.current
      || requestSeq !== searchSeq.current
      || requestedQuery !== query.current.trim().toLowerCase()
      || !permitted()
    ) return;

    const match = verification.users.find(user => user.uid === uid);
    if (!verification.ok || !match) {
      toast.show(verification.reason === 'missing-users'
        ? lt('此用戶目前無法選取，請重新搜尋', '此用戶目前無法選取，請重新搜尋')
        : lt('用戶驗證失敗，請檢查網路後再試', '用戶驗證失敗，請檢查網路後再試'));
      return;
    }
    if (
      uid === latest.current.viewer.uid
      || selected.current.length >= 3
      || selected.current.some(item => item.uid === uid)
    ) return;
    selected.current = [...selected.current, { uid, name: directoryName(match) }];
    searchSeq.current += 1;
    query.current = '';
    results.current = [];
    open.current = false;
    render();
  };

  const verifyForSubmit = async (): Promise<SubmitResult> => {
    const changed = (): SubmitResult => ({
      ok: false,
      message: lt('委託人名單已變更，請重新送出', '委託人名單已變更，請重新送出'),
    });
    if (!alive.current) return changed();
    if (!permitted() || selected.current.length === 0) return { ok: true };

    const requestSession = session.current;
    const requestSeq = ++submitSeq.current;
    const requestedUids = [...new Set(selected.current.map(item => item.uid.trim()).filter(Boolean))];

    // 照 A _waitForActivityCreateDependency；逾時後的結果不得更新膠囊。
    const outcome = await new Promise<VerificationOutcome>(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: VerificationOutcome): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        cancellations.current.delete(cancel);
        resolve(value);
      };
      const cancel = (): void => finish({ kind: 'cancelled' });
      cancellations.current.add(cancel);
      timer = setTimeout(() => finish({ kind: 'timeout' }), DELEGATE_TIMEOUT_MS);
      try {
        verifyUserDirectorySelection(requestedUids).then(
          result => finish({ kind: 'result', result }),
          () => finish({ kind: 'error' }),
        );
      } catch {
        finish({ kind: 'error' });
      }
    });

    if (
      !alive.current
      || requestSession !== session.current
      || requestSeq !== submitSeq.current
      || !permitted()
      || requestedUids.join('|') !== selected.current.map(item => item.uid).join('|')
    ) return changed();

    if (outcome.kind === 'cancelled') return changed();
    if (outcome.kind === 'timeout') {
      return {
        ok: false,
        message: lt('委託人驗證逾時，請檢查網路後再試', '委託人驗證逾時，請檢查網路後再試'),
      };
    }
    if (outcome.kind === 'error') {
      return {
        ok: false,
        message: lt('委託人驗證失敗，請稍後再試', '委託人驗證失敗，請稍後再試'),
      };
    }

    const verification = outcome.result;
    const fresh = new Map(verification.users.map(user => [user.uid, user]));
    if (
      !verification.ok
      || verification.users.length !== requestedUids.length
      || !requestedUids.every(uid => fresh.has(uid))
    ) {
      return {
        ok: false,
        message: verification.reason === 'missing-users'
          ? lt('委託人資料已失效，請重新選擇後再送出', '委託人資料已失效，請重新選擇後再送出')
          : lt('無法驗證委託人，請檢查網路後再試', '無法驗證委託人，請檢查網路後再試'),
      };
    }

    selected.current = requestedUids.map(uid => ({
      uid,
      name: directoryName(fresh.get(uid)!),
    }));
    render();
    return { ok: true };
  };

  const canManage = permitted();
  const directory = getUserDirectory();
  return {
    value: selected.current.map(item => ({ uid: item.uid.trim(), name: item.name.trim() }))
      .filter(item => item.uid),
    reset,
    verifyForSubmit,
    view: {
      chips: selected.current.map(item => ({
        ...item,
        role: directory.find(user => user.uid === item.uid)?.role || 'user',
      })),
      canManage,
      query: query.current,
      results: canManage ? results.current : [],
      dropdownOpen: canManage && open.current && selected.current.length < 3,
      placeholder: !canManage
        ? lt('無權設定委託人', '無權設定委託人')
        : selected.current.length >= 3
          ? lt('已達上限 3 人', '已達上限 3 人')
          : lt('搜尋用戶...', '搜尋用戶...'),
      inputDisabled: !canManage || selected.current.length >= 3,
      onQuery(value) {
        if (!alive.current || !permitted() || selected.current.length >= 3) return;
        query.current = value;
        if (!value.trim()) {
          searchSeq.current += 1;
          results.current = [];
          open.current = false;
          render();
          return;
        }
        search(getUserDirectory().length === 0).catch(() => undefined);
      },
      onFocus() {
        if (!alive.current || !permitted() || selected.current.length >= 3) return;
        clearBlur();
        const force = !focusedOnce.current || getUserDirectory().length === 0;
        focusedOnce.current = true;
        search(force).catch(() => undefined);
      },
      onPick(uid) {
        pick(uid).catch(() => {
          if (alive.current) {
            toast.show(lt('用戶驗證失敗，請檢查網路後再試', '用戶驗證失敗，請檢查網路後再試'));
          }
        });
      },
      onRemove(uid) {
        if (!alive.current) return;
        if (!permitted()) {
          toast.show(lt('權限不足', '權限不足'));
          return;
        }
        selected.current = selected.current.filter(item => item.uid !== uid);
        results.current = query.current.trim() ? matching(query.current) : [];
        render();
      },
    },
  };
}

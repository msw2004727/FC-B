import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { UserProfile } from '@/features/profile/data/profile-model';
import { canCreateEvent } from '../../data/event-create';
import { createEventContextFromViewer } from '../../data/event-create-context';
import { CreateEventTypeSheet } from './CreateEventTypeSheet';
import {
  invalidateEventFormPostSave,
  useEventFormSession,
} from './use-event-form-post-save';

type Editors = typeof import('@/features/profile/ui/editors');

interface ProfileState {
  uid: string;
  profile: UserProfile;
  editors: Editors;
}

interface ProfileRequest {
  uid: string;
  promise: Promise<ProfileState>;
}

export interface CreateEventEntry {
  canCreate: boolean;
  profileLocked: boolean;
  buttonProps: {
    lockedClass: string;
    'aria-disabled'?: 'true' | 'false';
    'data-profile-incomplete'?: '1';
    title?: string;
  };
  onClick(): void;
  formOpen: boolean;
  closeForm(): void;
  overlays: JSX.Element | null;
}

export function useCreateEventEntry(viewer: ViewerView): CreateEventEntry {
  const lt = useLegacyT();
  const [loaded, setLoaded] = useState<ProfileState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const mounted = useRef(false);
  const generation = useRef(0);
  const request = useRef<ProfileRequest | null>(null);
  const cached = useRef<ProfileState | null>(null);
  const clickBusy = useRef(false);
  const currentViewer = useRef(viewer);
  currentViewer.current = viewer;

  const ctx = createEventContextFromViewer(viewer);
  const canCreate = ctx !== null && canCreateEvent(ctx);
  const current = loaded?.uid === viewer.uid ? loaded : null;
  const profileLocked = Boolean(
    canCreate && current && current.editors.needsFirstLogin(current.profile),
  );

  useEventFormSession(formOpen);

  async function readProfile(uid: string, force = false): Promise<ProfileState> {
    if (!force && cached.current?.uid === uid) return cached.current;
    if (!force && request.current?.uid === uid) return request.current.promise;

    const token = generation.current;
    // 先宣告為 null：非同步區塊回來時才比對，TS 需要初始值（PM 修正）。
    let pending: ProfileRequest | null = null;

    const promise = (async (): Promise<ProfileState> => {
      // 照 A _isActivityCreateProfileComplete；重型依賴只走動態載入。
      const [model, editors] = await Promise.all([
        import('@/features/profile/data/profile-model'),
        import('@/features/profile/ui/editors'),
      ]);
      const result = await model.loadUserProfile(uid);
      // ASSUMPTION: 查無使用者文件視為資料不完整，以 UID 建立資料卡讀模型，不直接寫入。
      const profile: UserProfile = result ?? {
        uid,
        name: '',
        _docId: uid,
        lastActive: null,
      };
      const value = { uid, profile, editors };

      if (
        mounted.current
        && token === generation.current
        && currentViewer.current.uid === uid
        && request.current === pending
      ) {
        cached.current = value;
        setLoaded(value);
      }
      return value;
    })();

    pending = { uid, promise };
    request.current = pending;
    try {
      return await promise;
    } finally {
      if (request.current === pending) request.current = null;
    }
  }

  useLayoutEffect(() => {
    mounted.current = true;
    generation.current += 1;
    cached.current = null;
    request.current = null;
    clickBusy.current = false;
    setLoaded(null);
    setSheetOpen(false);
    setEditorOpen(false);
    setFormOpen(false);

    const uid = viewer.uid;
    if (uid) {
      // 照 A：預讀不阻擋畫面；按下時會重試失敗的讀取。
      readProfile(uid).catch(() => undefined);
    }

    return () => {
      mounted.current = false;
      generation.current += 1;
      request.current = null;
      cached.current = null;
      clickBusy.current = false;
    };
  }, [viewer.uid]);

  function allowed(): boolean {
    const latest = createEventContextFromViewer(currentViewer.current);
    return latest !== null && canCreateEvent(latest);
  }

  function deny(): void {
    toast.show({
      message: lt('權限不足：需要建立活動權限', '權限不足：需要建立活動權限'),
    });
  }

  function onClick(): void {
    if (!mounted.current || clickBusy.current) return;
    if (!allowed()) {
      deny();
      return;
    }
    const uid = currentViewer.current.uid;
    if (!uid) return;

    // 照 A _beginEventFormSession：新入口取消前一次延遲分享。
    invalidateEventFormPostSave();
    const token = generation.current;
    clickBusy.current = true;

    const isCurrent = (): boolean =>
      mounted.current
      && token === generation.current
      && currentViewer.current.uid === uid;

    (async () => {
      const value = await readProfile(uid);
      if (!isCurrent()) return;
      if (!allowed()) {
        deny();
        return;
      }

      if (value.editors.needsFirstLogin(value.profile)) {
        toast.show({
          message: lt('請先完成個人資料，再建立活動。', '請先完成個人資料，再建立活動。'),
        });
        setEditorOpen(true);
        return;
      }
      setSheetOpen(true);
    })()
      .catch(() => {
        if (!isCurrent()) return;
        // ASSUMPTION: 無法確認完整度時不放行，沿用 A 的建立功能載入失敗文案。
        toast.show({
          message: lt('活動建立功能載入失敗，請稍後再試', '活動建立功能載入失敗，請稍後再試'),
        });
      })
      .finally(() => {
        if (isCurrent()) clickBusy.current = false;
      });
  }

  function afterProfileSaved(): void {
    const uid = currentViewer.current.uid;
    if (!uid || !mounted.current) return;
    const token = generation.current;
    setEditorOpen(false);
    cached.current = null;

    // 照 A _refreshActivityCreateButton：成功重讀後解鎖，不自動開表單。
    readProfile(uid, true).catch(() => {
      if (
        !mounted.current
        || token !== generation.current
        || currentViewer.current.uid !== uid
      ) return;
      toast.show({
        message: lt('活動建立功能載入失敗，請稍後再試', '活動建立功能載入失敗，請稍後再試'),
      });
    });
  }

  let overlays: JSX.Element | null = null;
  if (editorOpen && current) {
    const Editor = current.editors.FirstLoginEditor;
    overlays = (
      <Editor
        key={current.uid}
        uid={current.uid}
        profile={current.profile}
        onClose={() => setEditorOpen(false)}
        onSaved={afterProfileSaved}
      />
    );
  } else if (sheetOpen) {
    overlays = (
      <CreateEventTypeSheet
        open
        viewer={viewer}
        onClose={() => setSheetOpen(false)}
        onCustom={() => {
          if (!mounted.current) return;
          if (!allowed()) {
            deny();
            return;
          }
          setFormOpen(true);
        }}
      />
    );
  }

  return {
    canCreate,
    profileLocked,
    buttonProps: profileLocked
      ? {
          lockedClass: 'activity-create-profile-locked',
          'aria-disabled': 'true',
          'data-profile-incomplete': '1',
          title: lt('請先完成個人資料，再建立活動', '請先完成個人資料，再建立活動'),
        }
      // 照 A _refreshActivityCreateButton：未鎖定時 aria-disabled='false'（Gemini 審 P3）。
      : { lockedClass: '', 'aria-disabled': 'false' },
    onClick,
    formOpen,
    closeForm: () => setFormOpen(false),
    overlays,
  };
}

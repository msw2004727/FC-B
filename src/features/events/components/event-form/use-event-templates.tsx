import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { EventFormState } from '../../data/event-form-model';
import { resolveCreatorName } from '../../data/event-form-model';
import type { EventLocationValue } from './use-event-location';
import {
  MAX_EVENT_TEMPLATES,
  buildTemplateFromForm,
  deleteEventTemplate,
  loadEventTemplates,
  saveEventTemplate,
  templateToFormPatch,
  type EventTemplateDoc,
} from '../../data/event-templates';
import { generateId } from '@/data/ids';

export interface EventTemplatesView {
  templates: readonly { id: string; name: string }[];
  loading: boolean;
  onLoad(id: string): void;
  onDelete(id: string): void;
  saveName: string;
  onSaveNameChange(name: string): void;
  onSave(): void;
}

interface HookInput {
  viewer: ViewerView;
  mode: 'create' | 'edit';
  /** false：掛載時不查範本，由呼叫端開表單時呼叫 reset() 才載入（照 A 只在開表單時載入）。 */
  loadOnMount?: boolean;
  onApply(result: ReturnType<typeof templateToFormPatch>, name: string): void;
  collect(): {
    state: EventFormState;
    image: string | null;
    location: EventLocationValue;
    canUseAddons: boolean;
  };
}

interface Scope {
  uid: string;
  active: boolean;
  sequence: number;
  busy: boolean;
  templates: EventTemplateDoc[];
  saveName: string;
  /** 掛載前（layout effect 開表單時）就要求載入，啟用後補載。 */
  loadRequested: boolean;
}

interface Snapshot {
  scope: Scope;
  loading: boolean;
  templates: EventTemplateDoc[];
  saveName: string;
}


export function useEventTemplates(input: HookInput): {
  view: EventTemplatesView;
  reload(): void;
  reset(): void;
} {
  const lt = useLegacyT();
  // ASSUMPTION: ViewerContext 的登入 UID 欄位為 uid；不使用角色或顯示名識別帳號。
  const uid = input.viewer.uid && input.viewer.uid !== 'unknown'
    ? input.viewer.uid
    : '';

  const scope = useMemo<Scope>(() => ({
    uid,
    active: false,
    sequence: 0,
    busy: false,
    templates: [],
    saveName: '',
    loadRequested: false,
  }), [uid]);

  const currentScope = useRef(scope);
  currentScope.current = scope;
  const latestInput = useRef(input);
  latestInput.current = input;

  const [snapshot, setSnapshot] = useState<Snapshot>({
    scope,
    loading: !!uid,
    templates: [],
    saveName: '',
  });

  function isCurrent(sequence?: number): boolean {
    return (
      scope.active
      && currentScope.current === scope
      && (sequence === undefined || sequence === scope.sequence)
    );
  }

  function publish(loading: boolean): void {
    if (!isCurrent()) return;
    setSnapshot({
      scope,
      loading,
      templates: [...scope.templates],
      saveName: scope.saveName,
    });
  }

  function show(message: string, params?: Record<string, string | number>): void {
    if (isCurrent()) toast.show(lt(message, message, params));
  }

  async function refresh(): Promise<void> {
    if (!isCurrent() || scope.busy) return;
    const sequence = ++scope.sequence;

    if (!scope.uid) {
      scope.templates = [];
      publish(false);
      return;
    }

    publish(true);
    try {
      const templates = await loadEventTemplates(scope.uid);
      if (!isCurrent(sequence)) return;
      scope.templates = templates;
    } catch {
      if (!isCurrent(sequence)) return;
      // ASSUMPTION: A 載入失敗只有 console；補可理解提示，不清掉上一份清單。
      show('範本載入失敗，請稍後重試');
    } finally {
      if (isCurrent(sequence)) publish(false);
    }
  }

  useEffect(() => {
    scope.active = true;
    // refresh 自行處理成功、失敗及過期結果。
    if (latestInput.current.loadOnMount !== false || scope.loadRequested) void refresh();
    scope.loadRequested = false;

    return () => {
      scope.active = false;
      scope.sequence += 1;
    };
  }, [scope]);

  function onLoad(id: string): void {
    if (!isCurrent()) return;
    const template = scope.templates.find((item) => item.id === id);
    if (!template) return;

    try {
      // ASSUMPTION: collect().canUseAddons 由 PM 使用既有 operate-permissions helper 計算；
      // 附件未提供該 helper，這裡不新增平行的角色／capability 判斷。
      const { canUseAddons } = latestInput.current.collect();
      const result = templateToFormPatch(template, canUseAddons);
      latestInput.current.onApply(result, template.name);
      // upsell 交由 onApply 依既有加值提示處理，避免捏造 A 未附文案。
      show('已載入範本「{name}」', { name: template.name });
    } catch {
      show('範本載入失敗，請稍後重試');
    }
  }

  async function save(): Promise<void> {
    if (!isCurrent() || scope.busy) return;

    const name = scope.saveName.trim();
    if (!name) {
      show('請輸入範本名稱');
      return;
    }
    if (!scope.uid) {
      show('範本儲存失敗');
      return;
    }

    scope.busy = true;
    const sequence = ++scope.sequence;
    publish(true);

    try {
      const collected = latestInput.current.collect();
      if (collected.state.genderRestrictionEnabled && !collected.state.allowedGender) {
        show('請先選擇限定性別，再儲存範本');
        return;
      }

      const allTemplates = await loadEventTemplates(scope.uid, { includeAllTypes: true });
      if (!isCurrent(sequence)) return;
      scope.templates = allTemplates.filter((template) => (
        !template.templateType || template.templateType === 'event' || template.templateType === 'normal'
      ));

      // 照 A：上限以本人全部雲端範本計算（ApiService.getEventTemplates() 不篩類型）。
      if (allTemplates.length >= MAX_EVENT_TEMPLATES) {
        show('範本數量已達上限 30 組');
        return;
      }

      // 等待清單期間權限可能改變，寫入前重新取得表單及 helper 的判斷結果。
      const current = latestInput.current;
      const fresh = current.collect();
      if (fresh.state.genderRestrictionEnabled && !fresh.state.allowedGender) {
        show('請先選擇限定性別，再儲存範本');
        return;
      }

      const template = buildTemplateFromForm({
        ...fresh,
        name,
        generateId,
        now: new Date(),
      });
      const ownerName = resolveCreatorName(
        current.viewer.displayName,
        current.viewer.role,
        current.viewer.permissionSources?.customRoles ?? [],
      );

      const saved = await saveEventTemplate({
        template: { ...template, ownerUid: scope.uid, ownerName },
        ownerUid: scope.uid,
        ownerName,
      });
      if (!isCurrent(sequence)) return;

      // 已有成功寫入收據；重新讀取失敗也不可回報「儲存失敗」誘發重複建立。
      scope.templates = [saved, ...scope.templates.filter((item) => item._docId !== saved._docId)];
      if (scope.saveName.trim() === name) scope.saveName = '';
      publish(true);

      try {
        const refreshed = await loadEventTemplates(scope.uid);
        if (!isCurrent(sequence)) return;
        scope.templates = refreshed;
      } catch {
        // 照 A 重新載入清單；讀取失敗保留成功寫入的結果供重試。
      }

      if (!isCurrent(sequence)) return;
      if (fresh.image?.startsWith('data:') && !saved.image) {
        show('圖片太大，已省略圖片後儲存範本');
      } else {
        show('範本「{name}」已儲存到雲端', { name });
      }
    } catch {
      if (isCurrent(sequence)) {
        // ASSUMPTION: 不使用會誤稱「已暫存本機」的 A 後備文案。
        show('範本儲存失敗');
      }
    } finally {
      scope.busy = false;
      if (isCurrent(sequence)) publish(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!isCurrent() || scope.busy || !scope.uid) return;
    const template = scope.templates.find((item) => item.id === id);
    if (!template) return;

    scope.busy = true;
    const sequence = ++scope.sequence;
    publish(true);

    try {
      // 照 A _deleteEventTemplate：直接刪除，不另加確認視窗。
      await deleteEventTemplate(template);
      if (!isCurrent(sequence)) return;

      scope.templates = scope.templates.filter((item) => item._docId !== template._docId);
      publish(true);

      try {
        const refreshed = await loadEventTemplates(scope.uid);
        if (!isCurrent(sequence)) return;
        scope.templates = refreshed;
      } catch {
        // 已刪除成功，保留刪除後清單，不誤報寫入失敗。
      }

      show('範本已刪除');
    } catch {
      if (isCurrent(sequence)) {
        // ASSUMPTION: 雲端限定模式刪除失敗保留 chip，不宣稱已刪本機資料。
        show('雲端刪除失敗');
      }
    } finally {
      scope.busy = false;
      if (isCurrent(sequence)) publish(false);
    }
  }

  const visible = snapshot.scope === scope ? snapshot : null;

  return {
    view: {
      templates: visible?.templates ?? [],
      loading: visible?.loading ?? !!uid,
      saveName: visible?.saveName ?? '',
      onSaveNameChange(name) {
        if (!isCurrent()) return;
        scope.saveName = name.slice(0, 20);
        publish(scope.busy || (visible?.loading ?? false));
      },
      onLoad,
      onDelete(id) {
        // remove 自行捕捉拒絕。
        void remove(id);
      },
      onSave() {
        // save 自行捕捉拒絕。
        void save();
      },
    },
    reload() {
      // refresh 自行捕捉拒絕。
      void refresh();
    },
    reset() {
      // 照 A 開表單：清空 ce-template-name 並重新載入範本。
      if (currentScope.current === scope && !scope.active) {
        scope.saveName = '';
        scope.loadRequested = true;
        return;
      }
      if (!isCurrent()) return;
      scope.saveName = '';
      publish(scope.busy || (visible?.loading ?? false));
      void refresh();
    },
  };
}

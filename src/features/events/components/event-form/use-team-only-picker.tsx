import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLegacyT } from '@/i18n/i18n';
import type { TeamDoc } from '@/features/clubs/data/types';
import type { ViewerView } from '@/features/profile/data/viewer';
import {
  createPermissionChecker,
} from '@/features/profile/data/permissions';
import {
  canManageAllActivities,
  hasUserActivityCapability,
  type OperateContext,
} from '../../data/operate-permissions';
import {
  getEventLimitedTeamIds,
  isTeamStaff,
} from '../../data/team-staff';
import type { EventDoc } from '../../data/types';

interface CreatorTeamUser {
  uid?: string | null;
  name?: string | null;
  displayName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
}

interface TeamOnlyPickerInput {
  viewer: ViewerView & CreatorTeamUser;
  // 選填：呼叫端可提供使用者目錄（只用 UID 比對）；B 目前不傳，未選俱樂部時由送出驗證提示「請選擇限定俱樂部」。
  adminUsers?: readonly CreatorTeamUser[];
  existing: EventDoc | null;
  mode: 'create' | 'edit';
  enabled: boolean;
  selectedIds: string[];
  onChange(ids: string[]): void;
}

type SubmitResult = { ok: true } | { ok: false; message: string };

interface TeamOnlyPickerResult {
  picker: JSX.Element | null;
  label: string;
  toggleDisabled: boolean;
  reset(initialIds: string[], initialNames: string[]): void;
  resolveSelection(): { ids: string[]; names: string[] };
  validateForSubmit(options?: { otherAddonsEnabled?: boolean }): Promise<SubmitResult>;
}

interface TeamOption {
  id: string;
  name: string;
}

interface PickerModel {
  candidates: TeamOption[];
  options: TeamOption[];
  existingIds: string[];
  preserveExistingScope: boolean;
}

interface Preset {
  ids: string[];
  names: string[];
}

interface DirectoryState {
  teams: TeamDoc[];
  ready: boolean;
  failed: boolean;
}

interface DirectoryRequest {
  promise: Promise<TeamDoc[]>;
}

/** 照 A `_isSameTeamOnlyScope`。 */
function normalizeIds(ids: readonly unknown[]): string[] {
  return [...new Set(ids.map(value => String(value || '').trim()).filter(Boolean))];
}

/** 照 A `_isSameTeamOnlyScope`。 */
function sameScope(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizeIds(left).sort();
  const b = normalizeIds(right).sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** 照 A `_buildTeamNameHints`。 */
function buildNameHints(ids: readonly string[], names: readonly string[]): Map<string, string> {
  const hints = new Map<string, string>();
  ids.forEach((value, index) => {
    const id = String(value || '').trim();
    const name = String(names[index] || '').trim();
    if (id && name) hints.set(id, name);
  });
  return hints;
}

/** 照 A `_canManageAllActivities`，來源沿用 B 已驗證的個別授權。 */
export function buildTeamOnlyContext(viewer: ViewerView): OperateContext {
  const sources = viewer.permissionSources;
  return {
    uid: viewer.uid,
    // ASSUMPTION: 缺 permissionSources 的測試替身視為尚無權限來源，不套用角色預設。
    role: sources ? viewer.role : null,
    rolePermissions: sources?.rolePermissions ?? null,
    userGrants: {
      uid: viewer.uid,
      enabled: true,
      permissions: sources?.userGrants ?? [],
    },
    capabilities: viewer.capabilities,
    customRoles: sources?.customRoles ?? [],
  };
}

/** 照 A `_resolveTeamDisplayName`；本單指定最後回退 id。 */
function displayName(
  id: string,
  hints: ReadonlyMap<string, string>,
  teams: readonly TeamDoc[],
): string {
  const hint = hints.get(id)?.trim();
  if (hint) return hint;
  const team = teams.find(item => String(item.id || item._docId || '').trim() === id);
  return team?.name?.trim() || id;
}

/** 照 A `_getTeamOnlyCandidateTeams`／`_populateTeamSelect`。 */
export function buildTeamOnlyModel(input: {
  teams: readonly TeamDoc[];
  uid: string | null;
  manageAll: boolean;
  existing: EventDoc | null;
  mode: 'create' | 'edit';
  presetIds: readonly string[];
  presetNames: readonly string[];
}): PickerModel {
  const hints = buildNameHints(input.presetIds, input.presetNames);
  const candidateMap = new Map<string, TeamOption>();

  for (const team of input.teams) {
    if (team.active === false) continue;
    if (!input.manageAll && !isTeamStaff(input.uid, team)) continue;
    const id = String(team.id || team._docId || '').trim();
    if (!id || candidateMap.has(id)) continue;
    candidateMap.set(id, {
      id,
      name: displayName(id, hints, input.teams),
    });
  }

  const candidates = [...candidateMap.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'zh-Hant'),
  );
  const existingIds = input.mode === 'edit' && input.existing?.teamOnly
    ? getEventLimitedTeamIds(input.existing)
    : [];
  const presetIds = normalizeIds(input.presetIds);
  const preserveExistingScope = !input.manageAll
    && existingIds.length > 0
    && sameScope(presetIds, existingIds);
  const optionMap = new Map(candidates.map(team => [team.id, team]));

  for (const id of presetIds) {
    if (optionMap.has(id)) continue;
    if (!input.manageAll && !existingIds.includes(id)) continue;
    optionMap.set(id, { id, name: displayName(id, hints, input.teams) });
  }

  const options = preserveExistingScope
    ? existingIds.flatMap(id => {
        const option = optionMap.get(id);
        return option ? [option] : [];
      })
    : [...optionMap.values()];

  return { candidates, options, existingIds, preserveExistingScope };
}

/** 照 A `_canCreateTeamOnlyActivityForSubmit`。 */
export function canCreateTeamOnlyForSubmit(input: {
  context: OperateContext;
  mode: 'create' | 'edit';
  selectedIds: readonly string[];
  teams: readonly TeamDoc[];
  hasOnlyTeamScopedAddon: boolean;
}): boolean {
  if (input.mode === 'edit') return true;

  const context = input.context;
  const uid = String(context.uid || '').trim();
  if (!uid || context.role === null) return false;

  const role = context.role.trim().toLowerCase() || 'user';
  const grant = context.userGrants;
  const validGrant = !!grant
    && grant.enabled !== false
    && String(grant.uid || '').trim() === uid;
  const hasPermission = createPermissionChecker({
    role,
    rolePermissions: context.rolePermissions === null
      ? {}
      : { [role]: context.rolePermissions },
    userGrants: validGrant && Array.isArray(grant.permissions)
      ? grant.permissions.filter((code: unknown): code is string => typeof code === 'string')
      : [],
    customRoles: context.customRoles,
  });
  const ids = normalizeIds(input.selectedIds);
  const selectedId = ids[0];
  const selectedTeam = ids.length === 1
    ? input.teams.find(team =>
        String(team.id || '').trim() === selectedId
        || String(team._docId || '').trim() === selectedId)
    : undefined;
  const hasExactStaffScope = ids.length === 1 && isTeamStaff(uid, selectedTeam);
  const manageAll = canManageAllActivities(context);
  const hasEventCreate = hasPermission('event.create');

  if (role === 'user') {
    const hasTeamCreateEvent = hasPermission('team.create_event');
    const hasBasicCreateCapability = hasUserActivityCapability(
      context,
      'user.activity.basic_create',
    );
    const hasAddonCapability = hasUserActivityCapability(
      context,
      'user.activity.addons_use',
    );
    const directGrantPath = input.hasOnlyTeamScopedAddon
      && hasEventCreate
      && hasTeamCreateEvent
      && hasExactStaffScope;
    const addonCapabilityPath = hasAddonCapability
      && (hasBasicCreateCapability || hasEventCreate)
      && (manageAll || (hasTeamCreateEvent && hasExactStaffScope));
    return directGrantPath || addonCapabilityPath;
  }

  const isCoachPlusRole = [
    'coach', 'captain', 'venue_owner', 'admin', 'super_admin',
  ].includes(role);
  const hasCreateEntry = isCoachPlusRole
    || hasPermission('activity.manage.entry')
    || hasPermission('event.edit_all')
    || hasEventCreate;
  const hasAllowedScope = manageAll || role === 'super_admin' || hasExactStaffScope;
  return hasCreateEntry && hasAllowedScope;
}

/** 照 A `_getEventCreatorTeam`；僅供顯示與第一階段檢查，不授予幹部權限。 */
function creatorTeamFallback(
  viewer: ViewerView & CreatorTeamUser,
  teams: readonly TeamDoc[],
  hints: ReadonlyMap<string, string>,
  adminUsers: readonly CreatorTeamUser[] = [],
): TeamOption | null {
  if (!viewer.uid) return null;

  const uid = viewer.uid || '';
  // A `_getEventCreatorTeam` 會再用名稱比對 adminUsers；違反 R-ID-002，B 只用 UID（刻意改良，PM 修正）。
  const source = viewer.teamId
    ? viewer
    : adminUsers.find(user => uid && user.uid === uid);
  if (!source?.teamId) return null;

  const id = String(source.teamId).trim();
  if (!id) return null;
  return {
    id,
    name: String(source.teamName || '').trim() || displayName(id, hints, teams),
  };
}

export function useTeamOnlyPicker(input: TeamOnlyPickerInput): TeamOnlyPickerResult {
  const lt = useLegacyT();
  const [directory, setDirectory] = useState<DirectoryState>({
    teams: [],
    ready: false,
    failed: false,
  });
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const preset = useRef<Preset>({ ids: [...input.selectedIds], names: [] });
  const latest = useRef(input);
  latest.current = input;
  const mounted = useRef(false);
  const sequence = useRef(0);
  const request = useRef<DirectoryRequest | null>(null);
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const wasEnabled = useRef(input.enabled);
  const appliedPopulation = useRef('');

  const context = buildTeamOnlyContext(input.viewer);
  const manageAll = canManageAllActivities(context);
  const toggleDisabled = input.mode === 'edit' && !manageAll;

  const modelFor = (current: TeamOnlyPickerInput, teams: readonly TeamDoc[]): PickerModel =>
    buildTeamOnlyModel({
      teams,
      uid: current.viewer.uid,
      manageAll: canManageAllActivities(buildTeamOnlyContext(current.viewer)),
      existing: current.existing,
      mode: current.mode,
      presetIds: preset.current.ids,
      presetNames: preset.current.names,
    });

  const model = modelFor(input, directory.teams);
  const selected = new Set(normalizeIds(input.selectedIds));
  const multiple = manageAll || (model.preserveExistingScope && model.existingIds.length > 1);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      request.current = null;
    };
  }, []);

  async function ensureDirectory(): Promise<boolean> {
    if (directoryRef.current.ready) return true;
    let activeRequest = request.current;
    if (!activeRequest) {
      activeRequest = {
        promise: import('@/features/clubs/data/teams-repo')
          .then(module => module.loadTeams()),
      };
      request.current = activeRequest;
    }
    const token = sequence.current;
    try {
      const teams = await activeRequest.promise;
      if (!mounted.current || token !== sequence.current) return false;
      const next = { teams, ready: true, failed: false };
      directoryRef.current = next;
      setDirectory(next);
      return true;
    } catch {
      if (mounted.current && token === sequence.current) {
        const next = { ...directoryRef.current, failed: true };
        directoryRef.current = next;
        setDirectory(next);
      }
      return false;
    } finally {
      if (request.current === activeRequest) request.current = null;
    }
  }

  useEffect(() => {
    const previouslyEnabled = wasEnabled.current;
    wasEnabled.current = input.enabled;
    if (!input.enabled) {
      sequence.current += 1;
      request.current = null;
      appliedPopulation.current = '';
      setQuery('');
      if (previouslyEnabled) {
        preset.current = { ids: [], names: [] };
        latest.current.onChange([]);
      }
      return;
    }

    // 照 A `_refreshTeamOnlyDirectoryIfOpen`；拒絕由 ensureDirectory 接住。
    void ensureDirectory();
  }, [input.enabled, revision]);

  useEffect(() => {
    if (!input.enabled || !directory.ready) return;
    const current = latest.current;
    const currentModel = modelFor(current, directory.teams);
    const currentAll = canManageAllActivities(buildTeamOnlyContext(current.viewer));
    const key = JSON.stringify([
      revision,
      current.viewer.uid,
      currentAll,
      current.mode,
      currentModel.existingIds,
      currentModel.options,
    ]);
    if (appliedPopulation.current === key) return;
    appliedPopulation.current = key;

    const allowed = new Set(currentModel.options.map(team => team.id));
    let ids = normalizeIds(current.selectedIds).filter(id => allowed.has(id));
    if (!currentAll && !currentModel.preserveExistingScope) ids = ids.slice(0, 1);
    if (ids.length === 0 && currentModel.options.length === 1) {
      const only = currentModel.options[0];
      if (only) ids = [only.id];
    }
    if (
      ids.length !== current.selectedIds.length
      || ids.some((id, index) => id !== current.selectedIds[index])
    ) {
      current.onChange(ids);
    }
  }, [
    input.enabled,
    directory,
    revision,
    input.viewer.uid,
    manageAll,
    input.mode,
    input.existing,
  ]);

  function reset(initialIds: string[], initialNames: string[]): void {
    sequence.current += 1;
    request.current = null;
    preset.current = { ids: [...initialIds], names: [...initialNames] };
    appliedPopulation.current = '';
    setQuery('');
    const current = latest.current;
    const currentModel = modelFor(current, directoryRef.current.teams);
    const currentAll = canManageAllActivities(buildTeamOnlyContext(current.viewer));
    const normalized = normalizeIds(initialIds);
    current.onChange(currentAll || currentModel.preserveExistingScope
      ? normalized
      : normalized.slice(0, 1));
    setRevision(value => value + 1);
  }

  function resolveSelection(): { ids: string[]; names: string[] } {
    const current = latest.current;
    const teams = directoryRef.current.teams;
    const currentModel = modelFor(current, teams);
    const hints = buildNameHints(preset.current.ids, preset.current.names);
    const ids = normalizeIds(current.selectedIds);

    if (ids.length > 0) {
      // 照 A selectedOptions 的清單順序；外部非法值保留給送出驗證拒絕。
      const order = new Map(currentModel.options.map((team, index) => [team.id, index]));
      ids.sort((a, b) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
      return { ids, names: ids.map(id => displayName(id, hints, teams)) };
    }
    if (currentModel.options.length > 0) return { ids: [], names: [] };

    const fallback = creatorTeamFallback(current.viewer, teams, hints, current.adminUsers);
    return fallback
      ? { ids: [fallback.id], names: [fallback.name] }
      : { ids: [], names: [] };
  }

  async function validateForSubmit(
    options?: { otherAddonsEnabled?: boolean },
  ): Promise<SubmitResult> {
    if (!latest.current.enabled) return { ok: true };
    const hasOnlyTeamScopedAddon = options?.otherAddonsEnabled === false;
    const validationInput = latest.current;
    const token = sequence.current;
    await ensureDirectory();
    if (!mounted.current || token !== sequence.current) {
      return {
        ok: false,
        message: lt('權限不足：無法建立此俱樂部限定活動', '權限不足：無法建立此俱樂部限定活動'),
      };
    }
    const current = latest.current;
    if (!current.enabled) return { ok: true };
    if (
      current.viewer !== validationInput.viewer
      || current.adminUsers !== validationInput.adminUsers
      || current.existing !== validationInput.existing
      || current.mode !== validationInput.mode
      || !sameScope(current.selectedIds, validationInput.selectedIds)
    ) {
      return {
        ok: false,
        message: lt('權限不足：無法建立此俱樂部限定活動', '權限不足：無法建立此俱樂部限定活動'),
      };
    }
    // 照 A：刷新失敗不另設送出錯誤；保留現有目錄與選取，
    // 繼續由下方選取、範圍及建立權限分支決定結果與文案。
    const teams = directoryRef.current.teams;
    const currentModel = modelFor(current, teams);
    const currentContext = buildTeamOnlyContext(current.viewer);
    const currentAll = canManageAllActivities(currentContext);
    const hints = buildNameHints(preset.current.ids, preset.current.names);
    const creatorTeam = creatorTeamFallback(
      current.viewer, teams, hints, current.adminUsers,
    );
    const selectedIds = normalizeIds(current.selectedIds);

    // 照 A handleCreateEvent：先檢查 creator team／select.value。
    if (!creatorTeam && selectedIds.length === 0) {
      return {
        ok: false,
        message: lt('請選擇限定俱樂部', '請選擇限定俱樂部'),
      };
    }

    const resolved = resolveSelection();
    if (resolved.ids.length === 0) {
      return {
        ok: false,
        message: lt('請至少選擇 1 支俱樂部', '請至少選擇 1 支俱樂部'),
      };
    }

    if (!currentAll) {
      if (current.mode === 'edit') {
        if (
          !current.existing?.teamOnly
          || currentModel.existingIds.length === 0
          || !sameScope(resolved.ids, currentModel.existingIds)
        ) {
          return {
            ok: false,
            message: lt(
              '非總管編輯活動時不能變更限定俱樂部',
              '非總管編輯活動時不能變更限定俱樂部',
            ),
          };
        }
      } else if (
        resolved.ids.length !== 1
        || !currentModel.candidates.some(team => team.id === resolved.ids[0])
      ) {
        return {
          ok: false,
          message: lt(
            '非總管建立俱樂部限定活動時，只能選擇 1 支由你管理的俱樂部',
            '非總管建立俱樂部限定活動時，只能選擇 1 支由你管理的俱樂部',
          ),
        };
      }
    }

    if (!canCreateTeamOnlyForSubmit({
      context: currentContext,
      mode: current.mode,
      selectedIds: resolved.ids,
      teams,
      // 明確沒有其他 addon 才開放直接授權路徑；未傳時維持保守行為。
      hasOnlyTeamScopedAddon,
    })) {
      return {
        ok: false,
        message: lt('權限不足：無法建立此俱樂部限定活動', '權限不足：無法建立此俱樂部限定活動'),
      };
    }
    return { ok: true };
  }

  function setSelected(id: string, checked: boolean): void {
    const current = latest.current;
    const currentAll = canManageAllActivities(buildTeamOnlyContext(current.viewer));
    if (current.mode === 'edit' && !currentAll) return;
    const currentModel = modelFor(current, directoryRef.current.teams);
    if (!currentModel.options.some(team => team.id === id)) return;
    const values = normalizeIds(current.selectedIds);
    const next = checked
      ? currentAll ? normalizeIds([...values, id]) : [id]
      : values.filter(value => value !== id);
    current.onChange(next);
  }

  const resolved = input.enabled ? resolveSelection() : { ids: [], names: [] };
  let label = '';
  if (input.enabled) {
    if (model.candidates.length === 0 && resolved.ids.length === 0) {
      label = lt('已啟用：目前沒有可選俱樂部', '已啟用：目前沒有可選俱樂部');
    } else if (resolved.ids.length === 0) {
      label = lt('已啟用：請至少選擇 1 支俱樂部', '已啟用：請至少選擇 1 支俱樂部');
    } else if (resolved.ids.length === 1) {
      label = lt('已啟用：僅限「{name}」', '已啟用：僅限「{name}」', {
        name: resolved.names[0] || resolved.ids[0] || '',
      });
    } else {
      label = lt('已啟用：已選 {n} 支俱樂部', '已啟用：已選 {n} 支俱樂部', {
        n: String(resolved.ids.length),
      });
    }
  }

  const selectedOptions = model.options.filter(team => selected.has(team.id));
  const keyword = query.trim().toLowerCase();
  const filtered = model.options.filter(team => team.name.toLowerCase().includes(keyword));

  // 照 A pages/activity.html 的 picker 外殼；開關與 label 由呼叫端呈現。
  const picker = input.enabled ? (
    <div
      id="ce-team-picker"
      class="ce-team-picker"
      style={{ display: model.options.length === 0 ? 'none' : '' }}
      aria-busy={!directory.ready && !directory.failed}
    >
      <div id="ce-team-chips" class="ce-team-chips">
        {selectedOptions.length > 0
          ? selectedOptions.map(team => (
              <button
                key={team.id}
                type="button"
                class="ce-team-chip"
                data-team-id={team.id}
                title={toggleDisabled
                  ? lt('限定俱樂部不可變更', '限定俱樂部不可變更')
                  : lt('取消選擇 {name}', '取消選擇 {name}', { name: team.name })}
                disabled={toggleDisabled}
                aria-disabled={toggleDisabled ? 'true' : undefined}
                onClick={() => setSelected(team.id, false)}
              >
                <span>{team.name}</span>
                <span class="ce-team-chip-remove">{lt('×', '×')}</span>
              </button>
            ))
          : <span class="ce-team-placeholder">
              {lt('尚未選擇俱樂部', '尚未選擇俱樂部')}
            </span>}
      </div>
      <input
        id="ce-team-search"
        class="ce-team-search"
        type="text"
        placeholder={lt('搜尋俱樂部名稱', '搜尋俱樂部名稱')}
        data-i18n-placeholder="搜尋俱樂部名稱"
        value={query}
        disabled={toggleDisabled}
        onInput={event => setQuery(event.currentTarget.value)}
      />
      <div id="ce-team-list" class="ce-team-list">
        {filtered.length > 0
          ? filtered.map(team => (
              <label key={team.id} class="ce-team-item">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name="ce-team-scope"
                  data-team-id={team.id}
                  checked={selected.has(team.id)}
                  disabled={toggleDisabled}
                  onChange={event => setSelected(team.id, event.currentTarget.checked)}
                />
                <span>{team.name}</span>
              </label>
            ))
          : <div class="ce-team-empty">
              {lt('找不到符合的俱樂部', '找不到符合的俱樂部')}
            </div>}
      </div>
    </div>
  ) : null;

  return { picker, label, toggleDisabled, reset, resolveSelection, validateForSubmit };
}

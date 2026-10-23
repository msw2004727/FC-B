import type { ComponentType, JSX } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  ImageCropperOptions,
  ImageCropperProps,
} from '@/features/events/components/event-form/ImageCropper';
import type { DirectoryUser } from '@/features/events/data/user-directory';
import { SPORTS } from '@/features/events/data/sports';
import { toast } from '@/ui/Toast';
import {
  canAssignCoach,
  canCreateTeam,
  canEditTeamSettings,
  canTransferCaptain,
} from '../../club-policy';
import {
  submitCreateTeam,
  submitEditTeam,
} from '../../data/team-form-actions';
import type {
  TeamFormImages,
  TeamFormViewer as ActionViewer,
} from '../../data/team-form-actions';
import {
  normalizeTeamCategory,
  TEAM_CATEGORY_OPTIONS,
} from '../../data/team-form-model';
import type {
  TeamFormStaffMember,
  TeamFormValues,
} from '../../data/team-form-model';
import { normalizeTeamContactLinks } from '../../data/team-contact-links';
import { filterTwRegions } from '../../data/taiwan-regions';
import type { TeamDoc } from '../../data/types';
import {
  useScopedStaffPicker,
  useStaffDirectory,
} from './use-team-staff-picker';
import type { StaffPickerApi } from './use-team-staff-picker';

/**
 * ASSUMPTION: 附件 ViewerView.displayName 實際允許 null，
 * 因此入口接受 null；呼叫既有 action 前轉成 undefined，
 * 不修改卡 1b 的 TeamFormViewer 匯出。
 */
export interface TeamFormViewer {
  uid: string | null;
  displayName?: string | null;
  hasPermission(code: string): boolean;
}

export interface TeamFormProps {
  mode: 'create' | 'edit';
  team?: TeamDoc | null;
  viewer: TeamFormViewer;
  onClose(): void;
  onSaved(result: {
    teamId: string;
    mode: 'create' | 'edit';
    roleSyncOk: boolean;
  }): void | Promise<void>;
}

interface StaffTag {
  key: string;
  name: string;
  uid: string | null;
}

export interface TeamFormApi {
  mode: 'create' | 'edit';
  title: string;
  submitLabel: string;
  busyLabel: string;
  values: TeamFormValues;
  setValue<K extends keyof TeamFormValues>(key: K, value: TeamFormValues[K]): void;
  categoryOptions: typeof TEAM_CATEGORY_OPTIONS;
  categoryHint: string;
  showEduSettings: boolean;
  sportOptions: { key: string; label: string }[];
  region: {
    suggestions: string[];
    open: boolean;
    onFocus(): void;
    onInput(v: string): void;
    onBlur(): void;
    pick(name: string): void;
  };
  contactLinks: {
    drafts: string[];
    setEnabled(on: boolean): void;
    setDraft(i: number, v: string): void;
    add(): void;
    remove(i: number): void;
    canAdd: boolean;
    previews: Array<{ platform: string; label: string } | null>;
  };
  captain: {
    displayText: string;
    lockedText: string | null;
    transferVisible: boolean;
    transferPicker: StaffPickerApi;
    selected: TeamFormStaffMember | null;
    pendingName: string | null;
    select(uid: string): Promise<void>;
    clear(): void;
  };
  leaders: {
    tags: StaffTag[];
    picker: StaffPickerApi;
    add(uid: string): Promise<void>;
    remove(tagKey: string): void;
  };
  coaches: {
    allowed: boolean;
    tags: StaffTag[];
    picker: StaffPickerApi;
    add(uid: string): Promise<void>;
    remove(tagKey: string): void;
  };
  image: {
    previewUrl: string | null;
    hasNew: boolean;
    pickFile(file: File): Promise<void>;
    cropper: JSX.Element | null;
  };
  busy: boolean;
  canSubmit: boolean;
  submit(): Promise<void>;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => typeof item === 'string' ? item.trim() : '')
    : [];
}

function firstNames(...values: unknown[]): string[] {
  for (const value of values) {
    const names = strings(value);
    if (names.length) return names;
  }
  return [];
}

function staffList(
  rawUids: string[],
  names: string[],
  users: readonly DirectoryUser[],
): { members: TeamFormStaffMember[]; unresolved: string[] } {
  const consumed = new Set<number>();
  const seen = new Set<string>();
  const members: TeamFormStaffMember[] = [];
  const positional = rawUids.length === names.length;

  for (const [index, rawUid] of rawUids.entries()) {
    const uid = rawUid.trim();
    if (!uid) continue;
    // 只透過 uid 解析身分；下方姓名比對只決定哪個顯示提示已消耗。
    const user = users.find(item => item.uid === uid);
    const directoryNames = user
      ? [user.name, user.displayName].map(name => name.trim().toLowerCase()).filter(Boolean)
      : [];
    let nameIndex = user
      ? names.findIndex((name, candidate) =>
        !consumed.has(candidate) && directoryNames.includes(name.toLowerCase()))
      : -1;
    if (nameIndex < 0 && positional && names[index]) nameIndex = index;
    if (nameIndex >= 0) consumed.add(nameIndex);

    if (!seen.has(uid)) {
      seen.add(uid);
      members.push({
        uid,
        name: user?.name || user?.displayName || names[nameIndex] || '',
      });
    }
  }

  const unresolved: string[] = [];
  const nameKeys = new Set<string>();
  names.forEach((name, index) => {
    if (!name || consumed.has(index) || nameKeys.has(name.toLowerCase())) return;
    nameKeys.add(name.toLowerCase());
    unresolved.push(name);
  });
  return { members, unresolved };
}

function initialValues(
  props: TeamFormProps,
  users: readonly DirectoryUser[],
): TeamFormValues {
  const team = props.mode === 'edit' ? props.team : null;
  const leaderUids = strings(team?.leaderUids);
  const leaders = staffList(
    leaderUids.length ? leaderUids : team?.leaderUid ? [team.leaderUid] : [],
    firstNames(team?.leaderNames, team?.leaders, team?.leader ? [team.leader] : []),
    users,
  );
  const coaches = staffList(
    strings(team?.coachUids),
    firstNames(team?.coachNames, team?.coaches),
    users,
  );
  const captainUid = team?.captainUid?.trim() || '';
  const captainUser = users.find(user => user.uid === captainUid);
  const captainName = team?.captainName || team?.captain || '';
  const links = normalizeTeamContactLinks(team?.contactLinks);
  const create = props.mode === 'create';

  return {
    type: create ? 'competitive' : normalizeTeamCategory(team?.type),
    sportTag: team?.sportTag || '',
    name: team?.name || '',
    nameEn: team?.nameEn || '',
    nationality: create ? '台灣' : team?.nationality || '',
    region: team?.region || '',
    founded: String(team?.founded ?? ''),
    contact: team?.contact || '',
    bio: team?.bio || '',
    eduAccepting: !team?.eduSettings || team.eduSettings.acceptingStudents !== false,
    contactLinksEnabled: !!team?.contactLinksEnabled && links.length > 0,
    contactLinkDrafts: links.length
      ? links.map(link => link.url)
      : team?.contactLinksEnabled ? [''] : [],
    captain: create
      ? props.viewer.uid
        ? { uid: props.viewer.uid, name: props.viewer.displayName || '' }
        : null
      : captainUid
        ? { uid: captainUid, name: captainUser?.name || captainUser?.displayName || captainName }
        : null,
    leaders: leaders.members,
    coaches: coaches.members,
    unresolvedLeaderNames: leaders.unresolved,
    unresolvedCoachNames: coaches.unresolved,
    unresolvedCaptainName: !create && !captainUid ? captainName : '',
  };
}

function tags(members: TeamFormStaffMember[], unresolved: string[]): StaffTag[] {
  return [
    ...members.map(member => ({
      key: `uid:${member.uid}`,
      uid: member.uid,
      name: member.name,
    })),
    ...unresolved.map((name, index) => ({
      key: `legacy:${index}`,
      uid: null,
      name,
    })),
  ];
}

// 與 use-team-image-upload 的 cover cropOptions 逐欄一致。
// 不修改既有 hook，也不引入它的上傳／隱藏 input DOM。
function coverCropOptions(index: 0 | 1): ImageCropperOptions {
  const common: ImageCropperOptions = {
    outputType: 'image/webp',
    quality: 0.9,
    maxZoom: 5,
    cancelText: '取消',
  };
  return index === 0 ? {
    ...common,
    aspectRatio: 8 / 3,
    outputWidth: 1200,
    outputHeight: 450,
    title: '俱樂部內頁封面 1/2',
    subtitle: '會用在俱樂部詳情頁上方的寬版封面。',
    targetLabel: '內頁封面',
    recommendedSize: '800 x 300',
    aspectLabel: '8:3',
    confirmText: '下一步',
  } : {
    ...common,
    aspectRatio: 1,
    outputWidth: 1000,
    outputHeight: 1000,
    title: '俱樂部卡片 2/2',
    subtitle: '會用在俱樂部列表與卡片型縮圖。',
    targetLabel: '俱樂部卡片',
    recommendedSize: '800 x 800',
    aspectLabel: '1:1',
    confirmText: '完成',
  };
}

let cropperModule:
  Promise<typeof import('@/features/events/components/event-form/ImageCropper')> | null = null;

function loadCropper(): Promise<
  typeof import('@/features/events/components/event-form/ImageCropper')
> {
  cropperModule ??= import('@/features/events/components/event-form/ImageCropper')
    .catch((error: unknown) => {
      cropperModule = null;
      throw error;
    });
  return cropperModule;
}

interface CropSequence {
  request: number;
  source: string;
  index: 0 | 1;
  cover?: string;
  Component: ComponentType<ImageCropperProps>;
}

export function useTeamForm(props: TeamFormProps): TeamFormApi {
  const identity = JSON.stringify([
    props.mode,
    props.team?._docId ?? props.team?.id ?? '',
    props.mode === 'edit' && !!props.team,
    props.viewer.uid,
  ]);
  const scope = useStaffDirectory(props.viewer.uid !== null, identity);
  const seed = useMemo(() => initialValues(props, scope.users), [scope]);
  const [values, setValues] = useState(seed);
  const valuesRef = useRef(seed);
  const latest = useRef({ props, scope });
  latest.current = { props, scope };
  const mounted = useRef(false);
  const dirtyRoles = useRef(new Set<'leaders' | 'coaches' | 'captain'>());
  const originalCaptain = useRef({
    member: seed.captain,
    name: seed.unresolvedCaptainName,
  });
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [regionSuggestions, setRegionSuggestions] = useState<string[]>([]);
  const [regionOpen, setRegionOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [images, setImages] = useState<TeamFormImages>({});
  const imagesRef = useRef<TeamFormImages>({});
  const [sequence, setSequence] = useState<CropSequence | null>(null);
  const imageRequest = useRef(0);
  const cropStep = useRef(0);
  const readerRef = useRef<FileReader | null>(null);

  const current = (): boolean =>
    mounted.current && latest.current.scope === scope;

  const cancelBlur = (): void => {
    if (blurTimer.current !== null) clearTimeout(blurTimer.current);
    blurTimer.current = null;
  };

  const abortReader = (): void => {
    const reader = readerRef.current;
    readerRef.current = null;
    if (reader?.readyState === 1) reader.abort();
  };

  const write = (next: TeamFormValues): void => {
    if (!current()) return;
    valuesRef.current = next;
    setValues(next);
  };

  useLayoutEffect(() => {
    mounted.current = true;
    valuesRef.current = seed;
    setValues(seed);
    originalCaptain.current = { member: seed.captain, name: seed.unresolvedCaptainName };
    dirtyRoles.current = new Set();
    locked.current = false;
    setBusy(false);
    setPendingName(null);
    setRegionSuggestions([]);
    setRegionOpen(false);
    imagesRef.current = {};
    setImages({});
    setSequence(null);
    imageRequest.current += 1;
    cropStep.current = 0;

    return () => {
      mounted.current = false;
      imageRequest.current += 1;
      cancelBlur();
      abortReader();
    };
  }, [scope, seed]);

  useLayoutEffect(() => {
    if (!scope.ready || !current()) return;
    const loaded = initialValues(latest.current.props, scope.users);
    const next = { ...valuesRef.current };
    if (!dirtyRoles.current.has('leaders')) {
      next.leaders = loaded.leaders;
      next.unresolvedLeaderNames = loaded.unresolvedLeaderNames;
    }
    if (!dirtyRoles.current.has('coaches')) {
      next.coaches = loaded.coaches;
      next.unresolvedCoachNames = loaded.unresolvedCoachNames;
    }
    originalCaptain.current = {
      member: loaded.captain,
      name: loaded.unresolvedCaptainName,
    };
    if (!dirtyRoles.current.has('captain')) {
      next.captain = loaded.captain;
      next.unresolvedCaptainName = loaded.unresolvedCaptainName;
    }
    write(next);
  }, [scope, scope.ready]);

  const permission = (): boolean => {
    const { viewer, mode, team } = latest.current.props;
    // ASSUMPTION: 既有 canEditTeamSettings 若採 ClubViewer 型別，
    // teamIds 不參與其 captain/creator/owner/manage_all 判定。
    const policyViewer = { ...viewer, teamIds: new Set<string>() };
    return mode === 'create'
      ? canCreateTeam(viewer)
      : !!team && canEditTeamSettings(policyViewer, team);
  };

  const transferAllowed = (): boolean => {
    const { viewer, mode, team } = latest.current.props;
    return mode === 'edit' && !!team && canTransferCaptain(viewer, team);
  };

  const coachAllowed = (): boolean => canAssignCoach(latest.current.props.viewer);
  const editable = (): boolean => current() && !locked.current;

  const transferVisible = props.mode === 'edit'
    && !!props.team && canTransferCaptain(props.viewer, props.team);
  const coachesAllowed = canAssignCoach(props.viewer);
  const leaderPicker = useScopedStaffPicker({
    enabled: props.viewer.uid !== null && !busy,
    excludeUids: values.leaders.map(member => member.uid),
  }, scope);
  const coachPicker = useScopedStaffPicker({
    enabled: props.viewer.uid !== null && coachesAllowed && !busy,
    excludeUids: values.coaches.map(member => member.uid),
  }, scope);
  const transferPicker = useScopedStaffPicker({
    enabled: transferVisible && !busy,
    excludeUids: values.captain ? [values.captain.uid] : [],
  }, scope);

  const setValue = <K extends keyof TeamFormValues>(
    key: K,
    value: TeamFormValues[K],
  ): void => {
    if (!editable()) return;
    if (key === 'captain' || key === 'unresolvedCaptainName') {
      if (!transferAllowed()) return;
      dirtyRoles.current.add('captain');
    }
    if (key === 'coaches' || key === 'unresolvedCoachNames') {
      if (!coachAllowed()) {
        toast.show({ message: '權限不足', tone: 'error' });
        return;
      }
      dirtyRoles.current.add('coaches');
    }
    if (key === 'leaders' || key === 'unresolvedLeaderNames') {
      dirtyRoles.current.add('leaders');
    }
    if (key === 'contactLinkDrafts' && Array.isArray(value) && value.length > 5) {
      toast.show({ message: '聯絡連結最多 5 個', tone: 'error' });
      return;
    }
    const next = { ...valuesRef.current, [key]: value };
    if (key === 'contactLinksEnabled' && value === true && !next.contactLinkDrafts.length) {
      next.contactLinkDrafts = [''];
    }
    write(next);
  };

  const addStaff = async (role: 'leaders' | 'coaches', uid: string): Promise<void> => {
    if (!editable()) return;
    if (role === 'coaches' && !coachAllowed()) {
      toast.show({ message: '權限不足', tone: 'error' });
      return;
    }
    const safeUid = uid.trim();
    if (!safeUid || valuesRef.current[role].some(member => member.uid === safeUid)) return;
    const picker = role === 'leaders' ? leaderPicker : coachPicker;
    const member = await picker.pick(safeUid);
    if (!member || !editable() || (role === 'coaches' && !coachAllowed())) return;
    if (valuesRef.current[role].some(item => item.uid === member.uid)) return;
    dirtyRoles.current.add(role);
    write({ ...valuesRef.current, [role]: [...valuesRef.current[role], member] });
    picker.setQuery('');
  };

  const removeStaff = (role: 'leaders' | 'coaches', key: string): void => {
    if (!editable()) return;
    if (role === 'coaches' && !coachAllowed()) {
      toast.show({ message: '權限不足', tone: 'error' });
      return;
    }
    const unresolvedKey = role === 'leaders' ? 'unresolvedLeaderNames' : 'unresolvedCoachNames';
    dirtyRoles.current.add(role);
    if (key.startsWith('uid:')) {
      write({
        ...valuesRef.current,
        [role]: valuesRef.current[role].filter(member => member.uid !== key.slice(4)),
      });
    } else if (key.startsWith('legacy:')) {
      const index = Number(key.slice(7));
      if (!Number.isInteger(index) || index < 0) return;
      write({
        ...valuesRef.current,
        [unresolvedKey]: valuesRef.current[unresolvedKey].filter((_, i) => i !== index),
      });
    }
  };

  const selectCaptain = async (uid: string): Promise<void> => {
    if (!editable() || !transferAllowed()) return;
    const member = await transferPicker.pick(uid);
    if (!member || !editable() || !transferAllowed()) return;
    dirtyRoles.current.add('captain');
    write({ ...valuesRef.current, captain: member, unresolvedCaptainName: '' });
    setPendingName(member.name);
    transferPicker.setQuery('');
  };

  const clearCaptain = (): void => {
    if (!editable() || !transferAllowed()) return;
    dirtyRoles.current.add('captain');
    write({
      ...valuesRef.current,
      captain: originalCaptain.current.member,
      unresolvedCaptainName: originalCaptain.current.name,
    });
    setPendingName(null);
    transferPicker.setQuery('');
  };

  const pickFile = async (file: File): Promise<void> => {
    if (!editable() || !permission()) return;
    const types = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!types.includes(file.type.toLowerCase()) && !extensions.includes(extension)) {
      toast.show({ message: '請上傳 JPG / PNG / WebP 圖片', tone: 'error' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.show({ message: '圖片太大，不能超過 5MB', tone: 'error' });
      return;
    }
    const request = ++imageRequest.current;
    abortReader();
    cropStep.current = 0;
    setSequence(null);

    try {
      const read = new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        readerRef.current = reader;
        const detach = (): void => {
          reader.onload = null;
          reader.onerror = null;
          reader.onabort = null;
          if (readerRef.current === reader) readerRef.current = null;
        };
        reader.onload = () => {
          const result = reader.result;
          detach();
          if (typeof result === 'string' && result) resolve(result);
          else reject(new Error('Image data URL unavailable'));
        };
        reader.onerror = () => {
          detach();
          reject(new Error('Image file read failed'));
        };
        reader.onabort = () => {
          detach();
          reject(new Error('Image file read aborted'));
        };
        try {
          reader.readAsDataURL(file);
        } catch (error) {
          detach();
          reject(error);
        }
      });
      const [source, module] = await Promise.all([read, loadCropper()]);
      if (!editable() || request !== imageRequest.current || !permission()) return;
      setSequence({ request, source, index: 0, Component: module.ImageCropper });
    } catch {
      if (!current() || request !== imageRequest.current) return;
      abortReader();
      toast.show({ message: '圖片處理失敗，請重試', tone: 'error' });
    }
  };

  const submit = async (): Promise<void> => {
    if (!editable()) return;
    const submittedProps = latest.current.props;
    if (!permission()) {
      toast.show({
        message: submittedProps.mode === 'create'
          ? '目前未開啟建立俱樂部權限'
          : '您沒有編輯此俱樂部的權限',
        tone: 'error',
      });
      return;
    }
    const submittedValues = valuesRef.current;
    const submittedImages = imagesRef.current;
    const viewer: ActionViewer = {
      uid: submittedProps.viewer.uid,
      displayName: submittedProps.viewer.displayName ?? undefined,
      hasPermission: code => submittedProps.viewer.hasPermission(code),
    };

    locked.current = true;
    setBusy(true);
    imageRequest.current += 1;
    abortReader();
    setSequence(null);

    try {
      const result = submittedProps.mode === 'create'
        ? await submitCreateTeam({ viewer, values: submittedValues, images: submittedImages })
        : submittedProps.team
          ? await submitEditTeam({
            viewer,
            team: submittedProps.team,
            values: submittedValues,
            images: submittedImages,
          })
          : null;

      if (!current() || !result) return;
      if (!result.ok) {
        toast.show({ message: result.message || '儲存失敗：', tone: 'error' });
        return;
      }
      toast.show({
        message: !result.roleSyncOk
          ? '俱樂部已儲存，但角色同步尚未完成，請稍後再儲存一次'
          : submittedProps.mode === 'create'
            ? '俱樂部建立成功！'
            : '俱樂部資料已更新',
        tone: result.roleSyncOk ? 'success' : 'error',
      });
      try {
        await submittedProps.onSaved({
          teamId: result.teamId,
          mode: submittedProps.mode,
          roleSyncOk: result.roleSyncOk,
        });
      } catch {
        // 寫入已成功；父層刷新失敗不得改報儲存失敗。
      }
      // onSaved 由 UI 負責關閉／刷新，避免另外呼叫 onClose 重複卸載。
    } catch {
      if (current()) toast.show({ message: '儲存失敗：', tone: 'error' });
    } finally {
      if (current()) {
        locked.current = false;
        setBusy(false);
      }
    }
  };

  let cropper: JSX.Element | null = null;
  if (sequence) {
    const crop = sequence;
    const { Component } = crop;
    const activeCrop = (): boolean =>
      editable()
      && permission()
      && crop.request === imageRequest.current
      && crop.index === cropStep.current;
    // ASSUMPTION: 附件既有 use-team-image-upload 直接渲染 ImageCropper，
    // 返回鍵／pushOverlay 由既有 ImageCropper 管理；此處沿用同一慣例，
    // 不猜測未附的 pushOverlay 模組路徑，也不重複註冊 overlay。
    cropper = (
      <Component
        key={`${identity}:${crop.request}:${crop.index}`}
        src={crop.source}
        options={coverCropOptions(crop.index)}
        onConfirm={dataUrl => {
          if (!activeCrop()) return;
          cropStep.current += 1;
          if (crop.index === 0) {
            setSequence({ ...crop, index: 1, cover: dataUrl });
          } else {
            const next: TeamFormImages = {
              coverDataUrl: crop.cover,
              cardDataUrl: dataUrl,
            };
            imagesRef.current = next;
            setImages(next);
            setSequence(null);
          }
        }}
        onCancel={() => {
          if (!current() || crop.request !== imageRequest.current) return;
          imageRequest.current += 1;
          setSequence(null);
        }}
      />
    );
  }

  const category = TEAM_CATEGORY_OPTIONS.find(option => option.key === values.type);
  const oldCaptainName = originalCaptain.current.member?.name
    || originalCaptain.current.name || '（未設定）';

  return {
    mode: props.mode,
    title: props.mode === 'create' ? '新增俱樂部' : '編輯俱樂部',
    submitLabel: props.mode === 'create' ? '建立俱樂部' : '儲存變更',
    busyLabel: props.mode === 'create' ? '建立中...' : '儲存中...',
    values,
    setValue,
    categoryOptions: TEAM_CATEGORY_OPTIONS,
    categoryHint: category?.formHint || '',
    showEduSettings: category?.showEduSettings || false,
    sportOptions: [
      { key: '', label: '未指定' },
      ...SPORTS.map(({ key, symbol, label }) => ({
        key,
        label: symbol ? `${symbol} ${label}` : label,
      })),
    ],
    region: {
      suggestions: regionSuggestions,
      open: regionOpen,
      onFocus() {
        if (!editable()) return;
        cancelBlur();
        const suggestions = filterTwRegions('', true);
        setRegionSuggestions(suggestions);
        setRegionOpen(suggestions.length > 0);
      },
      onInput(value) {
        if (!editable()) return;
        cancelBlur();
        write({ ...valuesRef.current, region: value });
        const suggestions = filterTwRegions(value, true);
        setRegionSuggestions(suggestions);
        setRegionOpen(suggestions.length > 0);
      },
      onBlur() {
        if (!current()) return;
        cancelBlur();
        blurTimer.current = setTimeout(() => {
          blurTimer.current = null;
          if (current()) setRegionOpen(false);
        }, 200);
      },
      pick(name) {
        if (!editable()) return;
        cancelBlur();
        write({ ...valuesRef.current, region: name });
        setRegionOpen(false);
      },
    },
    contactLinks: {
      drafts: values.contactLinkDrafts,
      setEnabled: on => setValue('contactLinksEnabled', on),
      setDraft(index, value) {
        if (!editable() || !Number.isInteger(index) || index < 0
          || index >= valuesRef.current.contactLinkDrafts.length) return;
        write({
          ...valuesRef.current,
          contactLinkDrafts: valuesRef.current.contactLinkDrafts.map(
            (draft, i) => i === index ? value : draft,
          ),
        });
      },
      add() {
        if (!editable()) return;
        if (valuesRef.current.contactLinkDrafts.length >= 5) {
          toast.show({ message: '聯絡連結最多 5 個', tone: 'error' });
          return;
        }
        write({
          ...valuesRef.current,
          contactLinkDrafts: [...valuesRef.current.contactLinkDrafts, ''],
        });
      },
      remove(index) {
        if (!editable() || valuesRef.current.contactLinkDrafts.length <= 1) return;
        write({
          ...valuesRef.current,
          contactLinkDrafts: valuesRef.current.contactLinkDrafts.filter((_, i) => i !== index),
        });
      },
      canAdd: values.contactLinkDrafts.length < 5,
      previews: values.contactLinkDrafts.map(draft => {
        const link = normalizeTeamContactLinks([draft])[0];
        return link ? { platform: link.platform, label: link.label } : null;
      }),
    },
    captain: {
      displayText: props.mode === 'create'
        ? `俱樂部經理（創立者）：${props.viewer.displayName || ''}`
        : `目前俱樂部經理：${oldCaptainName}`,
      lockedText: props.mode === 'create'
        ? '（創立者自動成為俱樂部經理）'
        : transferVisible ? null : '（僅俱樂部經理或管理員可轉移經理職位）',
      transferVisible,
      transferPicker,
      selected: values.captain,
      pendingName,
      select: selectCaptain,
      clear: clearCaptain,
    },
    leaders: {
      tags: tags(values.leaders, values.unresolvedLeaderNames),
      picker: leaderPicker,
      add: uid => addStaff('leaders', uid),
      remove: key => removeStaff('leaders', key),
    },
    coaches: {
      allowed: coachesAllowed,
      tags: tags(values.coaches, values.unresolvedCoachNames),
      picker: coachPicker,
      add: uid => addStaff('coaches', uid),
      remove: key => removeStaff('coaches', key),
    },
    image: {
      previewUrl: images.coverDataUrl
        || (props.mode === 'edit'
          ? props.team?.imageVariants?.cover || props.team?.image || null
          : null),
      hasNew: !!images.coverDataUrl && !!images.cardDataUrl,
      pickFile,
      cropper,
    },
    busy,
    canSubmit: permission(),
    submit,
  };
}

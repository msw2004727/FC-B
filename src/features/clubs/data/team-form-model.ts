import type { TeamCategoryKey } from './types';
import type { TeamContactLink } from './team-contact-links';
import { validateTeamContactLinksForm } from './team-contact-links';
import { TW_REGIONS_WITH_OTHER } from './taiwan-regions';
import { normalizeTeamCategory } from './team-list-model';

export { normalizeTeamCategory };

export interface TeamFormCategoryOption {
  key: TeamCategoryKey;
  label: string;
  description: string;
  formHint: string;
  showEduSettings: boolean;
}

// 對應 A js/modules/team/team-list-helpers.js:_getTeamCategoryOptions
// 對應 A pages/team.html:194-209（表單分類按鈕 description）
export const TEAM_CATEGORY_OPTIONS: readonly TeamFormCategoryOption[] = [
  {
    key: 'none',
    label: '無',
    description: '不顯示標籤',
    formHint: '不顯示任何標籤與緞帶，也不啟用課程功能。',
    showEduSettings: false,
  },
  {
    key: 'competitive',
    label: '競技',
    description: '賽事與戰績分類',
    formHint: '競技標籤只作為俱樂部分類，賽事系統設定已預留。',
    showEduSettings: false,
  },
  {
    key: 'education',
    label: '教學',
    description: '啟用課程功能',
    formHint: '教學標籤會啟用課程、學員與待審核功能。',
    showEduSettings: true,
  },
  {
    key: 'leisure',
    label: '休閒',
    description: '休閒交流分類',
    formHint: '休閒標籤只作為俱樂部分類，未來可銜接友誼賽或休閒賽事設定。',
    showEduSettings: false,
  },
];

/** 已由呼叫端使用者目錄解析；本層不呼叫目錄或 Firebase。 */
export interface TeamFormStaffMember {
  uid: string;
  name: string;
}

export interface TeamFormValues {
  type: TeamCategoryKey;
  sportTag: string;
  name: string;
  nameEn: string;
  nationality: string;
  region: string;
  founded: string;
  contact: string;
  bio: string;
  eduAccepting: boolean;
  contactLinksEnabled: boolean;
  contactLinkDrafts: string[];
  captain: TeamFormStaffMember | null;
  leaders: TeamFormStaffMember[];
  coaches: TeamFormStaffMember[];
  unresolvedLeaderNames: string[];
  unresolvedCoachNames: string[];
  unresolvedCaptainName: string;
}

export interface TeamFormContactLinks {
  enabled: boolean;
  links: TeamContactLink[];
}

export type TeamFormValidationResult =
  | { ok: true; contactLinks: TeamFormContactLinks }
  | { ok: false; message: string };

// 對應 A js/modules/team/team-form-validate.js:_extractTeamFormValues
export function validateTeamFormValues(
  values: TeamFormValues,
  mode: 'create' | 'edit',
): TeamFormValidationResult {
  if (!values.name.trim()) return { ok: false, message: '請輸入俱樂部名稱' };
  if (!values.sportTag) return { ok: false, message: '請選擇運動類型' };
  const region = values.region.trim();
  if (!region) return { ok: false, message: '請選擇地區' };
  if (!TW_REGIONS_WITH_OTHER.includes(region)) {
    return { ok: false, message: '地區必須從清單選擇' };
  }

  const contactLinks = validateTeamContactLinksForm(
    values.contactLinksEnabled,
    values.contactLinkDrafts,
  );
  if (contactLinks.error) return { ok: false, message: contactLinks.error };

  // ASSUMPTION: 編輯允許零領隊及未連結舊姓名；依附件 A 的 !editId 條件，
  // 不將新增模式的必填限制套到編輯模式。
  // ASSUMPTION: StaffMember 為已解析使用者，目錄存在性由後續寫入層驗證；
  // 本層無法重現 selectedCaptainUser 查無目錄的分支，不偽造遠端驗證結果。
  if (mode === 'create') {
    if (values.leaders.length === 0) {
      return { ok: false, message: '請選擇至少一位俱樂部領隊' };
    }
    if (!values.captain) {
      return { ok: false, message: '請設定俱樂部經理（必填）' };
    }
  }

  return {
    ok: true,
    contactLinks: { enabled: contactLinks.enabled, links: contactLinks.links },
  };
}

export interface TeamFormImageVariants {
  cover?: string;
  card?: string;
}

export interface TeamFormEduSettings {
  acceptingStudents: boolean;
  teachingEnabled: true;
}

/** 專用寫入欄位，不沿用 TeamDoc 或索引簽名。 */
export interface TeamFormCommonFields {
  name: string;
  nameEn: string;
  nationality: string;
  region: string;
  founded: string;
  contact: string;
  bio: string;
  contactLinksEnabled: boolean;
  contactLinks: TeamContactLink[];
  leader: string;
  leaderUid: string | null;
  leaders: string[];
  leaderUids: string[];
  leaderNames: string[];
  captain: string;
  captainUid: string | null;
  captainName: string;
  coaches: string[];
  coachUids: string[];
  coachNames: string[];
  type: TeamCategoryKey;
  sportTag: string;
  teachingEnabled: boolean;
}

export interface CreateTeamPayload extends TeamFormCommonFields {
  id: string;
  members: number;
  image: string | null;
  imageVariants?: TeamFormImageVariants;
  eduSettings?: TeamFormEduSettings;
  active: true;
  pinned: false;
  pinOrder: 0;
  wins: 0;
  draws: 0;
  losses: 0;
  gf: 0;
  ga: 0;
  history: [];
}

export interface UpdateTeamPatch extends TeamFormCommonFields {
  eduSettings: TeamFormEduSettings | null;
  image?: string | null;
  imageVariants?: TeamFormImageVariants;
}

export interface BuildCreateTeamPayloadArgs {
  teamId: string;
  values: TeamFormValues;
  contactLinks: TeamFormContactLinks;
  image: string | null;
  imageVariants: TeamFormImageVariants | null;
}

export interface BuildUpdateTeamPatchArgs {
  values: TeamFormValues;
  contactLinks: TeamFormContactLinks;
  image?: string | null;
  imageVariants?: TeamFormImageVariants | null;
}

// 對應 A js/modules/team/team-form-validate.js:_extractTeamFormValues/mergeUniqueNames
function mergeUniqueNames(...groups: readonly string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const name of group) {
      const value = String(name || '').trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

// 對應 A js/modules/team/team-form-roles.js:_applyTeamRoleChangesAfterSave/requestRoleRecalculation
function uniqueUids(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

// 對應 A js/modules/team/team-form-validate.js:_extractTeamFormValues
// 對應 A js/modules/team/team-form.js:handleSaveTeam
function buildCommonFields(
  values: TeamFormValues,
  contactLinks: TeamFormContactLinks,
): TeamFormCommonFields {
  const leaderNames = mergeUniqueNames(
    values.leaders.map((member) => member.name),
    values.unresolvedLeaderNames,
  );
  const coachNames = mergeUniqueNames(
    values.coaches.map((member) => member.name),
    values.unresolvedCoachNames,
  );
  // A 儲存所選 UID 陣列；成員數與副作用才另外進行 UID 去重。
  const leaderUids = values.leaders.map((member) => member.uid);
  const coachUids = values.coaches.map((member) => member.uid);
  const captain = values.captain?.name || values.unresolvedCaptainName.trim();
  const type = normalizeTeamCategory(values.type);

  return {
    name: values.name.trim(),
    nameEn: values.nameEn.trim(),
    nationality: values.nationality,
    region: values.region.trim(),
    founded: values.founded,
    contact: values.contact.trim(),
    bio: values.bio.trim(),
    contactLinksEnabled: contactLinks.enabled,
    contactLinks: contactLinks.links.map((link) => ({
      url: link.url,
      platform: link.platform,
      label: link.label,
      host: link.host,
    })),
    leader: leaderNames[0] || '',
    leaderUid: leaderUids[0] || null,
    leaders: [...leaderNames],
    leaderUids,
    leaderNames: [...leaderNames],
    captain,
    captainUid: values.captain?.uid || null,
    captainName: captain,
    coaches: [...coachNames],
    coachUids,
    coachNames: [...coachNames],
    type,
    sportTag: values.sportTag,
    teachingEnabled: type === 'education',
  };
}

// 對應 A js/modules/team/team-form.js:handleSaveTeam（imageVariants cover/card）
// 對應 A js/firebase-crud.js:addTeam（附件 CONTRACT.md 的圖片欄位契約）
function usableImageVariants(
  variants: TeamFormImageVariants | null | undefined,
): TeamFormImageVariants | undefined {
  if (!variants?.cover && !variants?.card) return undefined;
  return {
    ...(variants.cover ? { cover: variants.cover } : {}),
    ...(variants.card ? { card: variants.card } : {}),
  };
}

// 對應 A js/modules/team/team-form.js:handleSaveTeam（建立分支）
// 對應 A js/modules/team/team-list-stats.js:_calcTeamMemberCountByTeam
export function buildCreateTeamPayload(args: BuildCreateTeamPayloadArgs): CreateTeamPayload {
  const common = buildCommonFields(args.values, args.contactLinks);
  const variants = usableImageVariants(args.imageVariants);

  return {
    ...common,
    id: args.teamId,
    // 本卡 CONTRACT.md 明定新隊人數僅為幹部 UID 去重數，不加入未連結姓名。
    members: uniqueUids([
      common.captainUid,
      ...common.leaderUids,
      ...common.coachUids,
    ]).length,
    image: variants?.cover || variants?.card || args.image,
    ...(variants ? { imageVariants: variants } : {}),
    ...(common.type === 'education'
      ? { eduSettings: { acceptingStudents: args.values.eduAccepting, teachingEnabled: true as const } }
      : {}),
    active: true,
    pinned: false,
    pinOrder: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    history: [],
  };
}

// 對應 A js/modules/team/team-form.js:handleSaveTeam（編輯分支）
export function buildUpdateTeamPatch(args: BuildUpdateTeamPatchArgs): UpdateTeamPatch {
  const common = buildCommonFields(args.values, args.contactLinks);
  const variants = usableImageVariants(args.imageVariants);
  // ASSUMPTION: 未傳入／undefined／null variants 或無有效 cover/card 均代表無新 variants。
  // image 明確傳入 null 時保留 null；未傳入則省略，以本卡「只在傳入時出現」為準。
  // 上傳及 null eduSettings → deleteField 均由後續寫入層處理。
  return {
    ...common,
    eduSettings: common.type === 'education'
      ? { acceptingStudents: args.values.eduAccepting, teachingEnabled: true }
      : null,
    ...(variants ? { imageVariants: variants } : {}),
    ...(variants
      ? { image: variants.cover || variants.card || null }
      : args.image !== undefined ? { image: args.image } : {}),
  };
}

export interface TeamStaffSnapshot {
  captainUid?: string | null;
  leaderUids?: readonly string[];
  coachUids?: readonly string[];
}

export interface TeamStaffNotifyDiff {
  recalcUids: string[];
  notifyCaptain: string | null;
  notifyLeaders: string[];
  notifyCoaches: string[];
}

// 對應 A js/modules/team/team-form-roles.js:_applyTeamRoleChangesAfterSave
export function diffStaffForNotify(
  prev: TeamStaffSnapshot | null,
  next: TeamStaffSnapshot,
): TeamStaffNotifyDiff {
  // ASSUMPTION: prev=null 表示新增；prev 物件（即使空物件）表示編輯。
  // 呼叫端如讀到 legacy leaderUid，須先按 A 提取規則轉成 leaderUids。
  const oldCaptain = prev?.captainUid?.trim() || null;
  const captain = next.captainUid?.trim() || null;
  const oldLeaders = uniqueUids(prev?.leaderUids || []);
  const oldCoaches = uniqueUids(prev?.coachUids || []);
  const leaders = uniqueUids(next.leaderUids || []);
  const coaches = uniqueUids(next.coachUids || []);
  const notifyLeaders = leaders.filter((uid) => !oldLeaders.includes(uid));
  const notifyCoaches = coaches.filter((uid) => !oldCoaches.includes(uid));

  const recalc = [captain, ...notifyLeaders, ...coaches];
  if (prev !== null) {
    // ASSUMPTION: 本卡明定「被移除的舊經理也重算」，故 next 經理為 null 時
    // 仍重算舊經理；這個邊界刻意不同於 A 的 captainUid || oldCaptainUid 回退。
    if (oldCaptain && oldCaptain !== captain) recalc.push(oldCaptain);
    recalc.push(...oldCoaches.filter((uid) => !coaches.includes(uid)));
    recalc.push(...oldLeaders.filter((uid) => !leaders.includes(uid)));
  }

  return {
    recalcUids: uniqueUids(recalc),
    notifyCaptain: captain && captain !== oldCaptain ? captain : null,
    notifyLeaders,
    notifyCoaches,
  };
}

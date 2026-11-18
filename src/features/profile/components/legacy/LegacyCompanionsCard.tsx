import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

// generateId 與 PeopleEditor 同源（@/data/ids，R-ID-006）。
import { generateId } from '@/data/ids';

import { useLegacyT } from '@/i18n/i18n';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';

import type { UserProfile } from '../../data/profile-model';
import { saveCompanions } from '../../data/profile-writes';
import { CompanionModal, type CompanionDraft } from './CompanionModal';
import { ProfileInfoButton } from './ProfileInfoButton';
import './profile-mates.css';

/**
 * M-127：我的運動夥伴（就地展開）。
 * 照 A `profile-data-history.js#renderCompanions`、`toggleCompanionsSection`、
 * `saveCompanion`、`deleteCompanion`；DOM 照 `pages/profile.html#my-companions-card`。
 * 寫入一律 `saveCompanions(uid, nextCompanions)`（完整陣列寫回）。
 * 新 ID 用 `generateId('comp_')`，與 PeopleEditor 相同；comp_ 前綴是
 * A 與 Functions 辨識同行者的依據（isCompanionPseudoUid）。
 */

const GENDER_ICONS: Record<string, string> = { 男: '♂', 女: '♀' };

interface Companion {
  id: string;
  name: string;
  gender: string;
  notes: string;
  [key: string]: unknown;
}

function asCompanion(value: unknown): Companion {
  const obj = (value && typeof value === 'object' && !Array.isArray(value))
    ? (value as Record<string, unknown>)
    : {};
  return {
    ...obj,
    id: typeof obj['id'] === 'string' ? obj['id'] : '',
    name: typeof obj['name'] === 'string' ? obj['name'] : '',
    gender: typeof obj['gender'] === 'string' ? obj['gender'] : '',
    notes: typeof obj['notes'] === 'string' ? obj['notes'] : '',
  };
}

function readCompanions(profile: UserProfile): Companion[] {
  const raw = profile['companions'];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => asCompanion(entry));
}

export interface LegacyCompanionsCardProps {
  uid: string;
  profile: UserProfile;
  onSaved: (patch: { companions: unknown[] }) => void;
  /** 11-06 改版：放進個人頁圖示列的展開區時只渲染內容（外殼由 ProfileQuickBar 負責）。 */
  embedded?: boolean;
}

type ModalState =
  | { mode: 'add' }
  | { mode: 'edit'; companion: Companion }
  | null;

export function LegacyCompanionsCard(
  props: LegacyCompanionsCardProps,
): JSX.Element {
  const { uid, profile, onSaved, embedded = false } = props;
  const lt = useLegacyT();
  const [openState, setOpen] = useState(false);
  const open = embedded || openState;
  const [modal, setModal] = useState<ModalState>(null);
  const [pending, setPending] = useState(false);
  // 避免連按：state 更新可能被批次合併，用 ref 立即鎖。
  const pendingRef = useRef(false);

  const companions = readCompanions(profile);

  // 照 A saveCompanion / deleteCompanion：成功後呼叫 onSaved 讓頁面更新 profile。
  async function performSave(
    next: Companion[],
    successMessage: string,
  ): Promise<void> {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await saveCompanions(uid, next);
      onSaved({ companions: next });
      setModal(null);
      toast.show({ message: successMessage });
    } catch {
      // 失敗保留彈窗讓使用者重試；錯誤提示由底層 toast／全域處理。
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function handleSave(draft: CompanionDraft): void {
    if (modal === null) return;
    if (modal.mode === 'edit') {
      const next: Companion[] = companions.map((c) =>
        c.id === draft.id
          ? { ...c, name: draft.name, gender: draft.gender, notes: draft.notes }
          : c,
      );
      performSave(next, lt('運動夥伴已更新', '運動夥伴已更新')).catch(() => {
        /* 已於 performSave 內處理 */
      });
    } else {
      // 照 A saveCompanion：新增用 comp_ 前綴 + generateId（同 PeopleEditor）。
      const newCompanion: Companion = {
        id: generateId('comp_'),
        name: draft.name,
        gender: draft.gender,
        notes: draft.notes,
      };
      performSave([...companions, newCompanion], lt('運動夥伴已新增', '運動夥伴已新增')).catch(
        () => {
          /* 已於 performSave 內處理 */
        },
      );
    }
  }

  async function handleDelete(companionId: string): Promise<void> {
    if (pendingRef.current) return;
    // 照 A deleteCompanion：先 appConfirm 確認（2026-11-17 文案改「運動夥伴」）。
    const ok = await appConfirm(lt('確定要刪除此運動夥伴？', '確定要刪除此運動夥伴？'));
    if (!ok) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const next = companions.filter((c) => c.id !== companionId);
      await saveCompanions(uid, next);
      onSaved({ companions: next });
      toast.show({ message: lt('運動夥伴已刪除', '運動夥伴已刪除') });
    } catch {
      // 失敗保持現狀；錯誤由底層處理。
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const titleText = lt('我的運動夥伴', '我的運動夥伴');

  return (
    <div class={embedded ? 'profile-quick-body' : 'info-card'} id="my-companions-card">
      {embedded ? (
        <div class="profile-quick-help"><ProfileInfoButton infoKey="companions" /></div>
      ) : (
      <div
        class={`info-title profile-collapse-toggle${open ? ' open' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={titleText}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span style="display:flex;align-items:center;gap:.35rem">
          <ProfileInfoButton infoKey="companions" />
          <span data-i18n="我的運動夥伴">{titleText}</span>
          <span class="fav-count-badge" id="companions-count">
            {String(companions.length)}
          </span>
        </span>
        <span class="profile-collapse-arrow">▶</span>
      </div>
      )}
      <div
        class="profile-collapse-content"
        id="companions-list"
        style={open ? 'display:block' : 'display:none'}
      >
        {/* 2026-11-17 站長：夥伴改成一人一張卡片，名稱與編輯／刪除鈕放大（取代原本一行一列的小字清單）。 */}
        <div id="companions-inner-list" class="pmate-list">
          {companions.length === 0 ? (
            <div class="pmate-empty">{lt('尚無運動夥伴', '尚無運動夥伴')}</div>
          ) : (
            <>
              {companions.map((c, idx) => {
                const number = String(idx + 1);
                const icon = GENDER_ICONS[c.gender] ?? '';
                return (
                  <div key={c.id || String(idx)} class="pmate-card">
                    <span class="pmate-no" aria-hidden="true">{number}</span>
                    <div class="pmate-main">
                      {/* 顧問 §3.226：姓名獨佔一行（360 寬 8 個中文字內完整顯示），性別與備註移到第二行 */}
                      <div class="pmate-name">{c.name}</div>
                      {c.gender || c.notes ? (
                        <div class="pmate-sub">
                          {c.gender ? (
                            <span class="pmate-gender">{`${icon}${c.gender}`}</span>
                          ) : null}
                          {c.notes ? <span class="pmate-note">{c.notes}</span> : null}
                        </div>
                      ) : null}
                    </div>
                    <div class="pmate-actions">
                      <button
                        type="button"
                        class="outline-btn small profile-action-btn"
                        disabled={pending}
                        onClick={() => setModal({ mode: 'edit', companion: c })}
                      >
                        {lt('編輯', '編輯')}
                      </button>
                      <button
                        type="button"
                        class="outline-btn small profile-action-btn is-danger"
                        disabled={pending}
                        onClick={() => {
                          handleDelete(c.id).catch(() => {
                            /* 已於 handleDelete 內處理 */
                          });
                        }}
                      >
                        {lt('刪除', '刪除')}
                      </button>
                    </div>
                  </div>
                );
              })}
              <div class="pmate-hint">
                {lt(
                  '※ 序號為幫夥伴報名時的候補遞補順序',
                  '※ 序號為幫夥伴報名時的候補遞補順序',
                )}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          class="outline-btn pmate-add"
          disabled={pending}
          onClick={() => setModal({ mode: 'add' })}
        >
          {lt('+ 新增運動夥伴', '+ 新增運動夥伴')}
        </button>
      </div>
      {modal && (
        <CompanionModal
          key={modal.mode === 'edit' ? modal.companion.id : 'new'}
          mode={modal.mode}
          initial={modal.mode === 'edit' ? modal.companion : undefined}
          pending={pending}
          onClose={() => {
            if (!pending) setModal(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

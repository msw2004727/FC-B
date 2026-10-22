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

/**
 * M-127：我的運動夥伴（就地展開）。
 * 照 A `profile-data-history.js#renderCompanions`、`toggleCompanionsSection`、
 * `saveCompanion`、`deleteCompanion`；DOM 照 `pages/profile.html#my-companions-card`。
 * 寫入一律 `saveCompanions(uid, nextCompanions)`（完整陣列寫回）。
 * 新 ID 用 `generateId('comp_')`，與 PeopleEditor 相同；comp_ 前綴是
 * A 與 Functions 辨識同行者的依據（isCompanionPseudoUid）。
 */

const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
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
}

type ModalState =
  | { mode: 'add' }
  | { mode: 'edit'; companion: Companion }
  | null;

export function LegacyCompanionsCard(
  props: LegacyCompanionsCardProps,
): JSX.Element {
  const { uid, profile, onSaved } = props;
  const lt = useLegacyT();
  const [open, setOpen] = useState(false);
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
      performSave(next, lt('同行者已更新', '同行者已更新')).catch(() => {
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
      performSave([...companions, newCompanion], lt('同行者已新增', '同行者已新增')).catch(
        () => {
          /* 已於 performSave 內處理 */
        },
      );
    }
  }

  async function handleDelete(companionId: string): Promise<void> {
    if (pendingRef.current) return;
    // 照 A deleteCompanion：先 appConfirm('確定要刪除此同行者？')。
    const ok = await appConfirm(lt('確定要刪除此同行者？', '確定要刪除此同行者？'));
    if (!ok) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const next = companions.filter((c) => c.id !== companionId);
      await saveCompanions(uid, next);
      onSaved({ companions: next });
      toast.show({ message: lt('同行者已刪除', '同行者已刪除') });
    } catch {
      // 失敗保持現狀；錯誤由底層處理。
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const titleText = lt('我的運動夥伴', '我的運動夥伴');

  return (
    <div class="info-card" id="my-companions-card">
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
      <div
        class="profile-collapse-content"
        id="companions-list"
        style={open ? 'display:block' : 'display:none'}
      >
        <div id="companions-inner-list">
          {companions.length === 0 ? (
            <div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">
              {lt('尚無同行者', '尚無同行者')}
            </div>
          ) : (
            <>
              {companions.map((c, idx) => {
                const number =
                  CIRCLED_NUMS[idx] ?? String(idx + 1);
                const icon = GENDER_ICONS[c.gender] ?? '';
                return (
                  <div
                    key={c.id || String(idx)}
                    style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border)"
                  >
                    <div style="flex:1">
                      <span style="font-size:.85rem;font-weight:600">
                        <span style="color:var(--text-muted);margin-right:.2rem">
                          {number}
                        </span>
                        {c.name}
                      </span>
                      {c.gender ? (
                        <span style="font-size:.72rem;color:var(--text-muted);margin-left:.3rem">
                          {`${icon}${c.gender}`}
                        </span>
                      ) : null}
                      {c.notes ? (
                        <div style="font-size:.72rem;color:var(--text-muted)">
                          {c.notes}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      class="outline-btn"
                      style="font-size:.7rem;padding:.15rem .45rem"
                      disabled={pending}
                      onClick={() => setModal({ mode: 'edit', companion: c })}
                    >
                      {lt('編輯', '編輯')}
                    </button>
                    <button
                      type="button"
                      class="outline-btn"
                      style="font-size:.7rem;padding:.15rem .45rem;color:var(--danger);border-color:var(--danger)"
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
                );
              })}
              <div style="font-size:.7rem;color:var(--text-muted);margin-top:.3rem">
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
          class="outline-btn"
          style="width:100%;margin-top:.5rem;font-size:.8rem"
          disabled={pending}
          onClick={() => setModal({ mode: 'add' })}
        >
          {lt('+ 新增同行者', '+ 新增同行者')}
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

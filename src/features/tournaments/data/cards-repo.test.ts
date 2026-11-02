import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { FirestoreSdk } from '@/data/firestore-sdk';
import { TOURNAMENT_CARD_PERMISSION, type TournamentCard, type TournamentCardActor } from './card-model';
import {
  CREATE_FIELDS,
  IMAGE_MAX_BYTES,
  TournamentCardError,
  UPDATE_FIELDS,
  dataUrlBytes,
  deleteTournamentCard,
  loadTournamentCards,
  newTournamentCardId,
  saveTournamentCard,
  uploadTournamentCardImage,
  type CardsRepoDeps,
} from './cards-repo';

const TS = '__SERVER_TS__';

function actor(role: string, has: boolean, uid: string | null = `u_${role}`): TournamentCardActor {
  return { uid, role, hasPermission: (code) => has && code === TOURNAMENT_CARD_PERMISSION };
}
const MANAGER = actor('admin', true);
const DENIED: Array<[string, TournamentCardActor | null | undefined]> = [
  ['一般用戶', actor('user', false)],
  ['沒有權限碼的 coach', actor('coach', false)],
  ['訪客', actor('guest', true, null)],
  ['null', null],
];

function makeEnv(docs: Array<{ id: string; data: Record<string, unknown> }> = []) {
  const getDocs = vi.fn(async () => ({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) }));
  const getDoc = vi.fn();
  const collection = vi.fn((_db: unknown, name: string) => ({ collection: name }));
  const orderBy = vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] }));
  const limit = vi.fn((n: number) => ({ limit: n }));
  const where = vi.fn();
  const query = vi.fn((c: unknown, ...rest: unknown[]) => ({ c, rest }));
  const doc = vi.fn((_db: unknown, name: string, id: string) => ({ path: `${name}/${id}` }));
  const setDoc = vi.fn().mockResolvedValue(undefined);
  const updateDoc = vi.fn().mockResolvedValue(undefined);
  const deleteDoc = vi.fn().mockResolvedValue(undefined);
  const serverTimestamp = vi.fn(() => TS);
  const sdk = {
    getDocs,
    getDoc,
    collection,
    orderBy,
    limit,
    where,
    query,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
  } as unknown as FirestoreSdk;
  const upload = vi.fn(async (_dataUrl: string, _path: string) => 'https://storage.example/new.webp' as string | null);
  const remove = vi.fn(async (_path: string) => undefined);
  const warn = vi.fn();
  const deps: CardsRepoDeps = {
    getFirebase: async () => ({ db: {} as Firestore }),
    loadSdk: async () => sdk,
    newId: () => 'tc_1_abc',
    now: () => 1_760_000_000_000,
    storage: { upload, remove },
    warn,
  };
  return { deps, getDocs, getDoc, collection, orderBy, limit, where, query, doc, setDoc, updateDoc, deleteDoc, upload, remove, warn };
}

const WRITE = {
  name: 'FEDA CUP 2026 飛達盃',
  type: 'cup' as const,
  startDate: '2026-10-09',
  endDate: '2026-10-11',
  url: 'https://cup.toosterx.com/',
};

const EXISTING: TournamentCard = {
  id: 'tc_old',
  ...WRITE,
  image: 'https://storage.example/old.webp',
  imagePath: 'tournamentCards/tc_old/cover_1.webp',
};

describe('loadTournamentCards：讀取預算', () => {
  it('只發 1 個查詢：tournamentCards、orderBy(startDate, desc)、limit(100)，不讀舊站 tournaments', async () => {
    const env = makeEnv([
      { id: 'b', data: { ...WRITE, name: 'B', startDate: '2026-11-15', endDate: '2026-11-15' } },
      { id: 'a', data: { ...WRITE, name: 'A' } },
      { id: 'bad', data: { ...WRITE, url: 'javascript:alert(1)' } },
    ]);
    const cards = await loadTournamentCards(env.deps);

    expect(env.getDocs).toHaveBeenCalledTimes(1);
    expect(env.getDoc).not.toHaveBeenCalled();
    expect(env.where).not.toHaveBeenCalled();
    expect(env.collection).toHaveBeenCalledTimes(1);
    expect(env.collection).toHaveBeenCalledWith(expect.anything(), 'tournamentCards');
    expect(env.collection.mock.calls.some((call) => call[1] === 'tournaments')).toBe(false);
    expect(env.orderBy).toHaveBeenCalledWith('startDate', 'desc');
    expect(env.limit).toHaveBeenCalledWith(100);
    expect(env.query).toHaveBeenCalledWith(
      { collection: 'tournamentCards' },
      { orderBy: ['startDate', 'desc'] },
      { limit: 100 },
    );
    expect(cards.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('寫入權限：沒有權限一律拒絕、不碰 Firestore／Storage', () => {
  it.each(DENIED)('%s', async (_label, a) => {
    const env = makeEnv();
    await expect(
      saveTournamentCard({ existing: null, id: 'tc_1', write: WRITE, image: null }, a, env.deps),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(deleteTournamentCard(EXISTING, a, env.deps)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      uploadTournamentCardImage('tc_1', 'data:image/webp;base64,AAAA', a, env.deps),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(env.setDoc).not.toHaveBeenCalled();
    expect(env.updateDoc).not.toHaveBeenCalled();
    expect(env.deleteDoc).not.toHaveBeenCalled();
    expect(env.upload).not.toHaveBeenCalled();
  });

  it('總管不需要權限碼也可以寫', async () => {
    const env = makeEnv();
    await saveTournamentCard({ existing: null, id: 'tc_1', write: WRITE, image: null }, actor('super_admin', false), env.deps);
    expect(env.setDoc).toHaveBeenCalledTimes(1);
  });
});

describe('saveTournamentCard：新增', () => {
  it('setDoc 欄位剛好是白名單，createdBy 是操作者 uid', async () => {
    const env = makeEnv();
    const saved = await saveTournamentCard(
      {
        existing: null,
        id: 'tc_1',
        write: WRITE,
        image: { url: 'https://storage.example/new.webp', path: 'tournamentCards/tc_1/cover_1.webp' },
      },
      MANAGER,
      env.deps,
    );
    expect(env.doc).toHaveBeenCalledWith(expect.anything(), 'tournamentCards', 'tc_1');
    const payload = env.setDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([...CREATE_FIELDS].sort());
    expect(payload).toEqual({
      ...WRITE,
      image: 'https://storage.example/new.webp',
      imagePath: 'tournamentCards/tc_1/cover_1.webp',
      createdBy: 'u_admin',
      createdAt: TS,
      updatedAt: TS,
    });
    expect(saved).toEqual({
      id: 'tc_1',
      ...WRITE,
      image: 'https://storage.example/new.webp',
      imagePath: 'tournamentCards/tc_1/cover_1.webp',
    });
    expect(env.remove).not.toHaveBeenCalled();
  });

  it('沒有圖片也可以新增（image／imagePath 為空字串）', async () => {
    const env = makeEnv();
    await saveTournamentCard({ existing: null, id: 'tc_1', write: WRITE, image: null }, MANAGER, env.deps);
    expect(env.setDoc.mock.calls[0]?.[1]).toMatchObject({ image: '', imagePath: '' });
  });

  it('寫入層再驗一次：非 https 連結、日期顛倒都拒絕', async () => {
    const env = makeEnv();
    await expect(
      saveTournamentCard({ existing: null, id: 'tc_1', write: { ...WRITE, url: 'http://a.com/' }, image: null }, MANAGER, env.deps),
    ).rejects.toMatchObject({ code: 'invalid-payload' });
    await expect(
      saveTournamentCard(
        { existing: null, id: 'tc_1', write: { ...WRITE, startDate: '2026-10-12' }, image: null },
        MANAGER,
        env.deps,
      ),
    ).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(env.setDoc).not.toHaveBeenCalled();
  });

  it('不合格的 id 拒絕', async () => {
    const env = makeEnv();
    await expect(
      saveTournamentCard({ existing: null, id: 'a/b', write: WRITE, image: null }, MANAGER, env.deps),
    ).rejects.toMatchObject({ code: 'invalid-id' });
  });

  it('寫文件失敗：本次新上傳的圖片 best-effort 刪除後丟錯', async () => {
    const env = makeEnv();
    env.setDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(
      saveTournamentCard(
        { existing: null, id: 'tc_1', write: WRITE, image: { url: 'https://s/new.webp', path: 'tournamentCards/tc_1/cover_1.webp' } },
        MANAGER,
        env.deps,
      ),
    ).rejects.toThrow('permission-denied');
    expect(env.remove).toHaveBeenCalledWith('tournamentCards/tc_1/cover_1.webp');
  });
});

describe('saveTournamentCard：編輯', () => {
  it('updateDoc 不帶 createdBy／createdAt；沒換圖時保留原圖、不刪圖', async () => {
    const env = makeEnv();
    await saveTournamentCard(
      { existing: EXISTING, id: 'ignored', write: { ...WRITE, name: '新名稱' }, image: null },
      MANAGER,
      env.deps,
    );
    expect(env.doc).toHaveBeenCalledWith(expect.anything(), 'tournamentCards', 'tc_old');
    const payload = env.updateDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([...UPDATE_FIELDS].sort());
    expect(payload).toMatchObject({ name: '新名稱', image: EXISTING.image, imagePath: EXISTING.imagePath, updatedAt: TS });
    expect(env.remove).not.toHaveBeenCalled();
  });

  it('換圖成功後才刪舊圖；刪舊圖失敗只記警告', async () => {
    const env = makeEnv();
    env.remove.mockRejectedValueOnce(new Error('not-found'));
    const saved = await saveTournamentCard(
      { existing: EXISTING, id: 'tc_old', write: WRITE, image: { url: 'https://s/new.webp', path: 'tournamentCards/tc_old/cover_2.webp' } },
      MANAGER,
      env.deps,
    );
    expect(env.remove).toHaveBeenCalledWith(EXISTING.imagePath);
    expect(env.warn).toHaveBeenCalledTimes(1);
    expect(saved.imagePath).toBe('tournamentCards/tc_old/cover_2.webp');
  });
});

describe('deleteTournamentCard', () => {
  it('deleteDoc 後 best-effort 刪除圖片', async () => {
    const env = makeEnv();
    await deleteTournamentCard(EXISTING, MANAGER, env.deps);
    expect(env.deleteDoc).toHaveBeenCalledWith({ path: 'tournamentCards/tc_old' });
    expect(env.remove).toHaveBeenCalledWith(EXISTING.imagePath);
  });

  it('沒有圖片時不碰 Storage', async () => {
    const env = makeEnv();
    await deleteTournamentCard({ id: 'tc_x', imagePath: '' }, MANAGER, env.deps);
    expect(env.remove).not.toHaveBeenCalled();
  });

  it('deleteDoc 失敗時不刪圖片', async () => {
    const env = makeEnv();
    env.deleteDoc.mockRejectedValueOnce(new Error('denied'));
    await expect(deleteTournamentCard(EXISTING, MANAGER, env.deps)).rejects.toThrow('denied');
    expect(env.remove).not.toHaveBeenCalled();
  });
});

describe('uploadTournamentCardImage', () => {
  it('路徑 tournamentCards/{id}/cover_{時間}.webp', async () => {
    const env = makeEnv();
    const result = await uploadTournamentCardImage('tc_1', 'data:image/webp;base64,AAAA', MANAGER, env.deps);
    expect(env.upload).toHaveBeenCalledWith('data:image/webp;base64,AAAA', 'tournamentCards/tc_1/cover_1760000000000.webp');
    expect(result).toEqual({ url: 'https://storage.example/new.webp', path: 'tournamentCards/tc_1/cover_1760000000000.webp' });
  });

  it('上傳失敗回 null', async () => {
    const env = makeEnv();
    env.upload.mockResolvedValueOnce(null);
    expect(await uploadTournamentCardImage('tc_1', 'data:image/webp;base64,AAAA', MANAGER, env.deps)).toBeNull();
  });

  it('大於等於 2MB 擋下，不上傳', async () => {
    const env = makeEnv();
    const big = `data:image/webp;base64,${'A'.repeat(Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 4)}`;
    expect(dataUrlBytes(big)).toBeGreaterThanOrEqual(IMAGE_MAX_BYTES);
    await expect(uploadTournamentCardImage('tc_1', big, MANAGER, env.deps)).rejects.toBeInstanceOf(TournamentCardError);
    expect(env.upload).not.toHaveBeenCalled();
  });

  it('不是圖片 data URL 拒絕', async () => {
    const env = makeEnv();
    await expect(
      uploadTournamentCardImage('tc_1', 'https://evil.example/a.webp', MANAGER, env.deps),
    ).rejects.toMatchObject({ code: 'invalid-payload' });
  });
});

describe('newTournamentCardId', () => {
  it('用 generateId 的 tc_ 前綴', () => {
    expect(newTournamentCardId()).toMatch(/^tc_\d{13}_[a-z0-9]+$/);
  });
});

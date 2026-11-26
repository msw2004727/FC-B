// 詳情頁「分享賽事」鈕（CP-SHARE）：只在收到連結的人讀得到的賽事出現；按下開共用分享選單（賽事文案）。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { loadCompetitionsDict } from '../i18n';
import type { CompetitionDoc } from '../data/types';
import { hostActor, memberActor, screenEnv } from '../testing/screen-fixtures';
import CompetitionDetailPage from './CompetitionDetailPage';

const liff = vi.hoisted(() => ({
  isLoggedIn: () => true,
  isApiAvailable: () => true,
  shareTargetPicker: vi.fn(async (_messages: unknown[]) => ({ status: 'success' as const })),
}));
vi.mock('@line/liff', () => ({ default: liff }));

// 假的合格格式 id，不是任何真實賽事。
const CID = 'cp_TESTabcdefghij012345';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('.share-action-sheet').forEach((node) => node.parentElement?.remove());
  _resetOverlayBackForTest();
  vi.restoreAllMocks();
});

function env(patch: Partial<CompetitionDoc>, who = memberActor): CpInjectedEnv {
  const base = screenEnv('detail-rep');
  const bundle = base.bundle!;
  return {
    ...base,
    actor: who,
    route: { ...base.route, cid: CID },
    bundle: { ...bundle, competition: { ...bundle.competition!, id: CID, ...patch } },
  };
}

function draw(value: CpInjectedEnv) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={value}>
        <CompetitionDetailPage />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

describe('分享賽事鈕', () => {
  it('公開已發布：在頂部主資訊正下方', async () => {
    draw(env({}));
    const button = await screen.findByRole('button', { name: '分享賽事' });
    expect(button.closest('.cps-stack')).toBeTruthy();
    expect(document.querySelector('.d2-hero')?.nextElementSibling).toBe(button);
  });

  it.each([
    ['草稿', { status: 'draft' as const }, hostActor],
    ['內部賽', { visibility: 'internal' }, hostActor],
    ['下架（主辦仍讀得到）', { hidden: true }, hostActor],
    ['刪到一半', { hidden: true, deletingAt: 1 }, hostActor],
  ])('%s 不顯示', async (_label, patch, who) => {
    draw(env(patch, who));
    await screen.findByText('示範盃');
    expect(screen.queryByRole('button', { name: '分享賽事' })).toBeNull();
  });

  it('按下開共用分享選單（賽事標題與文案），選 LINE 好友送 Flex', async () => {
    draw(env({}));
    fireEvent.click(await screen.findByRole('button', { name: '分享賽事' }));
    const dialog = await screen.findByRole('dialog', { name: '分享賽事' });
    expect(dialog.closest('.legacy-ui')).toBeTruthy();
    expect(screen.getByText('LINE 好友')).toBeTruthy();
    expect(screen.getByText('LINE 社群')).toBeTruthy();
    expect(screen.getByText('複製連結')).toBeTruthy();
    fireEvent.click(screen.getByText('LINE 好友'));
    await waitFor(() => expect(liff.shareTargetPicker).toHaveBeenCalledOnce());
    expect(liff.shareTargetPicker.mock.calls[0]?.[0][0]).toMatchObject({
      type: 'flex',
      altText: expect.stringContaining(`?competition=${CID}`),
    });
  });
});

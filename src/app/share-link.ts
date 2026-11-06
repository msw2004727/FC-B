const PUBLIC_ID = /^[A-Za-z0-9_-]{1,120}$/;

export function resolveShareLink(url: string): string | null {
  const parsed = new URL(url, 'https://toosterx.invalid');
  if (parsed.pathname !== '/') return null;

  // ASSUMPTION: 同時提供 event/team/profile 時，依序 event → team → profile 優先；重複參數拒絕解析。
  // profile：A 名片分享與 B 自己的球員卡 QR 都產生 `?profile={uid}`（換站前必修，換站計畫書 D-3）。
  for (const [parameter, destination] of [
    ['event', 'events'],
    ['team', 'teams'],
    ['profile', 'profile'],
  ] as const) {
    const values = parsed.searchParams.getAll(parameter);
    if (values.length !== 1) {
      if (values.length > 1) return null;
      continue;
    }
    const id = values[0];
    if (id === undefined || !PUBLIC_ID.test(id)) return null;
    // `/profile/qr` 是固定頁面，不當 uid。
    if (parameter === 'profile' && id === 'qr') return null;
    return `/${destination}/${id}`;
  }
  return null;
}

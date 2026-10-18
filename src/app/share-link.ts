const PUBLIC_ID = /^[A-Za-z0-9_-]{1,120}$/;

export function resolveShareLink(url: string): string | null {
  const parsed = new URL(url, 'https://toosterx.invalid');
  if (parsed.pathname !== '/') return null;

  // ASSUMPTION: 同時提供 event/team 時，event 優先；重複參數拒絕解析。
  for (const [parameter, destination] of [
    ['event', 'events'],
    ['team', 'teams'],
  ] as const) {
    const values = parsed.searchParams.getAll(parameter);
    if (values.length !== 1) {
      if (values.length > 1) return null;
      continue;
    }
    const id = values[0];
    if (id === undefined || !PUBLIC_ID.test(id)) return null;
    return `/${destination}/${id}`;
  }
  return null;
}

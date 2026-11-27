import http from 'node:http';

/**
 * 記分模擬器測試專用的 REST 呼叫：每次開新連線、用完即關，不進全域 fetch 的連線池。
 *
 * 原因：Firestore SDK（useFetchStreams）也用全域 fetch 連同一個模擬器。模擬器回完 WebChannel
 * （Listen／Write channel）後會直接斷線，但回應沒帶 `Connection: close`，undici 會把那條連線放回池裡；
 * 測試的 REST 剛好撿到它時就是 `fetch failed`／`other side closed`（UND_ERR_SOCKET）。CI 失敗的
 * socket 已讀位元組 297／1391，正是 channel POST／GET 回應的大小（CP-CI-EMU-SOCKET）。
 * 只回傳測試用到的 status、ok、text()。
 */
export function emuFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; ok: boolean; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const body = init?.body;
    const req = http.request(url, {
      method: init?.method ?? 'GET',
      agent: false,
      headers: {
        ...init?.headers,
        Connection: 'close',
        ...(body === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(body)) }),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status, ok: status >= 200 && status < 300, text: async () => text });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

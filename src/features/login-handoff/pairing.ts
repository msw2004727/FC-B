// 與 functions/line-login-handoff.js 的 pairingNumber／pairingOptions 逐位元相同。
// 瀏覽器 crypto.subtle 是非同步的，所以這三個函式回 Promise。

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

export async function pairingNumber(handoffId: string): Promise<number> {
  const hash = await pairDigest(handoffId);
  return 10 + (readUInt32BE(hash) % 90);
}

export async function pairingOptions(handoffId: string): Promise<number[]> {
  const hash = await pairDigest(handoffId);
  const correct = 10 + (readUInt32BE(hash) % 90);
  const decoys: number[] = [];

  for (let i = 4; i < hash.length && decoys.length < 2; i += 1) {
    const byte = hash[i];
    if (byte === undefined) continue;
    const value = 10 + (byte % 90);
    if (value !== correct && !decoys.includes(value)) decoys.push(value);
  }

  for (let value = 10; decoys.length < 2 && value <= 99; value += 1) {
    if (value !== correct && !decoys.includes(value)) decoys.push(value);
  }

  const last = hash[31];
  const position = (last ?? 0) % 3;
  const options = decoys.slice();
  options.splice(position, 0, correct);
  return options;
}

async function pairDigest(handoffId: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`fcb-pair:${handoffId}`),
  );
  return new Uint8Array(digest);
}

function readUInt32BE(hash: Uint8Array): number {
  return new DataView(hash.buffer, hash.byteOffset, hash.byteLength).getUint32(0, false);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

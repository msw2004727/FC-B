// op 20 碼、sid 24 碼，都是 base64url。長度落在 Rules 的 8～24 與 16～32。

const OP_BYTES = 15;
const SID_BYTES = 18;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function createOp(randomBytes: (n: number) => Uint8Array): string {
  return bytesToBase64Url(randomBytes(OP_BYTES));
}

export function createSid(randomBytes: (n: number) => Uint8Array): string {
  return bytesToBase64Url(randomBytes(SID_BYTES));
}

export function browserRandom(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) throw new Error('這個環境沒有 crypto.getRandomValues');
  cryptoObj.getRandomValues(buf);
  return buf;
}

import { showWaitForPending, waitHandlers } from './claim';
import { HANDOFF_TTL_MS, readPending, writePending } from './pending';
import { pairingNumber, sha256Hex } from './pairing';
import { renderWait } from './view';

export async function beginLoginHandoff(cleanRedirectUri: string): Promise<string | null> {
  const existing = readPending();
  if (existing && Date.now() - existing.createdAt < HANDOFF_TTL_MS) {
    await showWaitForPending();
    return null;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = bytesToHex(bytes);
  const handoffId = await sha256Hex(secret);
  const createdAt = Date.now();
  writePending({ secret, createdAt });
  renderWait({
    kind: 'wait',
    number: await pairingNumber(handoffId),
    expiresAt: createdAt + HANDOFF_TTL_MS,
    busy: false,
  }, waitHandlers);
  const url = new URL(cleanRedirectUri);
  url.searchParams.set('fcbHandoff', handoffId);
  return url.toString();
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

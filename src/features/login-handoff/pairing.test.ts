import { describe, expect, it } from 'vitest';
import { pairingNumber, pairingOptions, sha256Hex } from './pairing';

describe('pairing 五組固定向量', () => {
  it('64 個 0 與 64 個 f', async () => {
    expect(await pairingNumber('0'.repeat(64))).toBe(64);
    expect(await pairingOptions('0'.repeat(64))).toEqual([66, 55, 64]);
    expect(await pairingNumber('f'.repeat(64))).toBe(48);
    expect(await pairingOptions('f'.repeat(64))).toEqual([31, 39, 48]);
  });

  it('sha256Hex 向量', async () => {
    const vectors: Array<[string, number, number[]]> = [
      ['vector-3', 52, [32, 87, 52]],
      ['vector-4', 87, [65, 87, 22]],
      ['vector-7', 28, [28, 93, 98]],
    ];
    for (const [text, number, options] of vectors) {
      const handoffId = await sha256Hex(text);
      expect(await pairingNumber(handoffId)).toBe(number);
      expect(await pairingOptions(handoffId)).toEqual(options);
    }
  });
});

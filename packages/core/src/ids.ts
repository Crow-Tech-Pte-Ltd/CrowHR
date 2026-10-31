import type { Clock, IdGenerator } from "./deps.ts";

type RandomBytes = (length: number) => Uint8Array;

const webCryptoRandom: RandomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

/**
 * RFC 9562 UUIDv7: 48-bit Unix-ms timestamp + random bits. Time-ordered, so
 * B-tree indexes on primary keys stay append-mostly. Uses Web Crypto, which
 * exists in Node 24 and every browser.
 */
export function createUuidV7Generator(clock: Clock, random: RandomBytes = webCryptoRandom): IdGenerator {
  return {
    newId() {
      const bytes = random(16);
      const ms = clock.now().getTime();
      // 48-bit big-endian timestamp. Use division, not bit shifts: ms exceeds 32 bits.
      bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
      bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
      bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
      bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
      bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
      bytes[5] = ms & 0xff;
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}

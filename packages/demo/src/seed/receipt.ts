/**
 * A small, real PNG that looks like a till receipt (paper, a header block, ruled "text" lines and
 * a bold total bar), so the receipt viewer has something to show. No text, no real merchant
 * artwork: the pattern is derived from the claim's own fields, so every receipt differs (and
 * duplicate detection, which hashes the bytes, doesn't fire between seeded claims).
 */
const W = 120;
const H = 180;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typed = new TextEncoder().encode(type);
  out.set(typed, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function seedFrom(text: string): () => number {
  let x = 2166136261;
  for (const ch of text) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1000) / 1000;
  };
}

export async function receiptPng(merchant: string, cents: number, date: string): Promise<Uint8Array> {
  const rand = seedFrom(`${merchant}|${cents}|${date}`);
  const px = new Uint8Array(W * H).fill(0xd8); // background (desk)
  const fill = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[y * W + x] = v;
  };
  fill(10, 6, W - 10, H - 6, 0xfb); // paper
  fill(30, 14, W - 30, 24, 0x30); // merchant header
  fill(40, 28, W - 40, 31, 0x90);
  let y = 42;
  const rows = 6 + Math.floor(rand() * 5);
  for (let i = 0; i < rows && y < H - 40; i++, y += 9) {
    fill(18, y, 18 + 30 + Math.floor(rand() * 34), y + 3, 0x70);
    fill(W - 18 - 18 - Math.floor(rand() * 8), y, W - 18, y + 3, 0x70);
  }
  fill(18, y + 4, W - 18, y + 5, 0xa0); // rule
  fill(18, y + 10, 52, y + 15, 0x20); // TOTAL
  fill(W - 18 - 26, y + 10, W - 18, y + 15, 0x20);
  // Zig-zag tear at the bottom.
  for (let x = 10; x < W - 10; x++) {
    const depth = 2 + ((x >> 2) % 2 ? 2 : 0);
    fill(x, H - 6 - depth, x + 1, H - 6, 0xd8);
  }

  const raw = new Uint8Array((W + 1) * H);
  for (let r = 0; r < H; r++) {
    raw[r * (W + 1)] = 0; // filter: none
    raw.set(px.subarray(r * W, (r + 1) * W), r * (W + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, W);
  v.setUint32(4, H);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlib(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

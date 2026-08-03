// QR code encoder — byte mode, versions 1-10, all four error-correction levels.
//
// Written rather than vendored: the app has no build step and refuses CDN
// dependencies, and a label generator that only works online would defeat the
// point. Versions 1-10 at level M hold 154 bytes, far more than the ~70-character
// location URLs this encodes.
//
// Reference: ISO/IEC 18004. The block-structure table below is the standard one.

/* ---- Galois field GF(256), primitive polynomial 0x11d ---- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

/** Generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree) {
  let poly = [1];
  for (let d = 0; d < degree; d++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= mul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

/** Error-correction codewords for one block. */
export function rsEncode(data, ecLength) {
  const gen = rsGenerator(ecLength);
  const remainder = new Uint8Array(ecLength);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecLength - 1] = 0;
    for (let i = 0; i < ecLength; i++) remainder[i] ^= mul(gen[i + 1], factor);
  }
  return remainder;
}

/* ---- Version / block structure ----
   [ecCodewordsPerBlock, group1Blocks, group1DataCodewords, group2Blocks, group2DataCodewords] */

const BLOCKS = {
  1:  { L: [7, 1, 19, 0, 0],    M: [10, 1, 16, 0, 0],   Q: [13, 1, 13, 0, 0],   H: [17, 1, 9, 0, 0] },
  2:  { L: [10, 1, 34, 0, 0],   M: [16, 1, 28, 0, 0],   Q: [22, 1, 22, 0, 0],   H: [28, 1, 16, 0, 0] },
  3:  { L: [15, 1, 55, 0, 0],   M: [26, 1, 44, 0, 0],   Q: [18, 2, 17, 0, 0],   H: [22, 2, 13, 0, 0] },
  4:  { L: [20, 1, 80, 0, 0],   M: [18, 2, 32, 0, 0],   Q: [26, 2, 24, 0, 0],   H: [16, 4, 9, 0, 0] },
  5:  { L: [26, 1, 108, 0, 0],  M: [24, 2, 43, 0, 0],   Q: [18, 2, 15, 2, 16],  H: [22, 2, 11, 2, 12] },
  6:  { L: [18, 2, 68, 0, 0],   M: [16, 4, 27, 0, 0],   Q: [24, 4, 19, 0, 0],   H: [28, 4, 15, 0, 0] },
  7:  { L: [20, 2, 78, 0, 0],   M: [18, 4, 31, 0, 0],   Q: [18, 2, 14, 4, 15],  H: [26, 4, 13, 1, 14] },
  8:  { L: [24, 2, 97, 0, 0],   M: [22, 2, 38, 2, 39],  Q: [22, 4, 18, 2, 19],  H: [26, 4, 14, 2, 15] },
  9:  { L: [30, 2, 116, 0, 0],  M: [22, 3, 36, 2, 37],  Q: [20, 4, 16, 4, 17],  H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69],  M: [26, 4, 43, 1, 44],  Q: [24, 6, 19, 2, 20],  H: [28, 6, 15, 2, 16] },
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const ECC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

function capacity(version, ecc) {
  const [, g1n, g1c, g2n, g2c] = BLOCKS[version][ecc];
  return g1n * g1c + g2n * g2c;
}

/* ---- Bit stream ---- */

class Bits {
  constructor() { this.bits = []; }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  get length() { return this.bits.length; }
  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => { if (bit) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

/* ---- Encode ---- */

function chooseVersion(byteLength, ecc) {
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + byteLength * 8) / 8);
    if (needed <= capacity(v, ecc)) return v;
  }
  throw new Error(`${byteLength} bytes is too much for a version-10 QR code`);
}

function buildCodewords(bytes, version, ecc) {
  const [ecPerBlock, g1n, g1c, g2n, g2c] = BLOCKS[version][ecc];
  const total = capacity(version, ecc);

  const stream = new Bits();
  stream.push(0b0100, 4);                                  // byte mode
  stream.push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) stream.push(b, 8);

  // Terminator, then pad to a whole codeword, then the alternating pad bytes.
  stream.push(0, Math.min(4, total * 8 - stream.length));
  while (stream.length % 8) stream.push(0, 1);

  const data = Array.from(stream.toBytes());
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < total; i++) data.push(PAD[i % 2]);

  // Split into blocks, compute EC per block.
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1n; i++) { blocks.push(data.slice(offset, offset + g1c)); offset += g1c; }
  for (let i = 0; i < g2n; i++) { blocks.push(data.slice(offset, offset + g2c)); offset += g2c; }
  const ecBlocks = blocks.map(b => rsEncode(b, ecPerBlock));

  // Interleave: column-wise across blocks, data first, then EC.
  const out = [];
  const maxData = Math.max(...blocks.map(b => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* ---- Matrix ---- */

function blankMatrix(size) {
  return {
    size,
    modules: Array.from({ length: size }, () => new Int8Array(size).fill(-1)),
    reserved: Array.from({ length: size }, () => new Uint8Array(size)),
  };
}

function place(m, r, c, value, reserve = true) {
  if (r < 0 || c < 0 || r >= m.size || c >= m.size) return;
  m.modules[r][c] = value ? 1 : 0;
  if (reserve) m.reserved[r][c] = 1;
}

function addFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6))
                  || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      place(m, rr, cc, inRing || inCore);
    }
  }
}

function addAlignment(m, version) {
  const centers = ALIGNMENT[version];
  for (const r of centers) {
    for (const c of centers) {
      // Skip the three corners already occupied by finder patterns.
      if ((r === 6 && c === 6) || (r === 6 && c === m.size - 7) || (r === m.size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          place(m, r + dr, c + dc, ring !== 1);
        }
      }
    }
  }
}

function addTiming(m) {
  for (let i = 8; i < m.size - 8; i++) {
    place(m, 6, i, i % 2 === 0);
    place(m, i, 6, i % 2 === 0);
  }
}

function reserveFormat(m) {
  for (let i = 0; i < 9; i++) {
    if (i !== 6) { m.reserved[8][i] = 1; m.reserved[i][8] = 1; }
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8][m.size - 1 - i] = 1;
    m.reserved[m.size - 1 - i][8] = 1;
  }
  place(m, m.size - 8, 8, 1);   // the always-dark module
}

function reserveVersion(m, version) {
  if (version < 7) return;
  for (let i = 0; i < 18; i++) {
    const r = Math.floor(i / 3), c = i % 3;
    m.reserved[r][m.size - 11 + c] = 1;
    m.reserved[m.size - 11 + c][r] = 1;
  }
}

/** Zigzag placement, bottom-right upwards, two columns at a time. */
function placeData(m, codewords) {
  let bitIndex = 0;
  const nextBit = () => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit;
  };

  let upward = true;
  for (let right = m.size - 1; right > 0; right -= 2) {
    if (right === 6) right--;                       // the vertical timing column
    for (let step = 0; step < m.size; step++) {
      const row = upward ? m.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (m.reserved[row][col]) continue;
        m.modules[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0,
  (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0,
];

function applyMask(m, maskIndex) {
  const fn = MASKS[maskIndex];
  const out = {
    size: m.size,
    modules: m.modules.map(row => Int8Array.from(row)),
    reserved: m.reserved,
  };
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.reserved[r][c] && fn(r, c)) out.modules[r][c] ^= 1;
    }
  }
  return out;
}

/** BCH(15,5) format information, per the standard. */
export function formatBits(ecc, mask) {
  const data = (ECC_BITS[ecc] << 3) | mask;
  let value = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (value & (1 << (i + 10))) value ^= 0x537 << i;
  }
  return ((data << 10) | value) ^ 0x5412;
}

/** BCH(18,6) version information, for versions 7 and up. */
export function versionBits(version) {
  let value = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (value & (1 << (i + 12))) value ^= 0x1f25 << i;
  }
  return (version << 12) | value;
}

function writeFormat(m, ecc, mask) {
  const bits = formatBits(ecc, mask);
  const bit = i => (bits >> i) & 1;

  for (let i = 0; i <= 5; i++) place(m, 8, i, bit(i));
  place(m, 8, 7, bit(6));
  place(m, 8, 8, bit(7));
  place(m, 7, 8, bit(8));
  for (let i = 9; i <= 14; i++) place(m, 14 - i, 8, bit(i));

  // Second copy. The split is 7 bits down the bottom-left column and 8 along
  // row 8 — not 8 and 7. Getting this off by one leaves (8, size-8) unwritten
  // and corrupts the copy a scanner falls back to when the first is damaged.
  for (let i = 0; i <= 6; i++) place(m, m.size - 1 - i, 8, bit(i));
  for (let i = 7; i <= 14; i++) place(m, 8, m.size - 15 + i, bit(i));

  place(m, m.size - 8, 8, 1);   // dark module, always set, overwrites bit 7's slot
}

function writeVersion(m, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const r = Math.floor(i / 3), c = i % 3;
    place(m, r, m.size - 11 + c, bit);
    place(m, m.size - 11 + c, r, bit);
  }
}

/* ---- Mask penalty (ISO 18004 §8.8.2) ---- */

function penalty(m) {
  const n = m.size;
  const at = (r, c) => m.modules[r][c];
  let score = 0;

  // Rule 1: runs of five or more identical modules.
  for (let i = 0; i < n; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const cur  = horizontal ? at(i, j) : at(j, i);
        const prev = horizontal ? at(i, j - 1) : at(j - 1, i);
        if (cur === prev) { run++; }
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules beside them.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (get, start) =>
    A.every((v, k) => get(start + k) === v) || B.every((v, k) => get(start + k) === v);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j + 11 <= n; j++) {
      if (matches(k => at(i, k), j)) score += 40;
      if (matches(k => at(k, i), j)) score += 40;
    }
  }

  // Rule 4: deviation from a 50/50 light-dark balance.
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += at(r, c);
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ---- Public API ---- */

/**
 * Encode text as a QR matrix.
 * @returns {{size:number, modules:Int8Array[], version:number, ecc:string, mask:number}}
 */
export function encode(text, { ecc = 'M', minVersion = 1 } = {}) {
  const bytes = new TextEncoder().encode(text);
  const version = Math.max(chooseVersion(bytes.length, ecc), minVersion);
  const codewords = buildCodewords(bytes, version, ecc);
  const size = version * 4 + 17;

  const base = blankMatrix(size);
  addFinder(base, 0, 0);
  addFinder(base, 0, size - 7);
  addFinder(base, size - 7, 0);
  addAlignment(base, version);
  addTiming(base);
  reserveFormat(base);
  reserveVersion(base, version);
  placeData(base, codewords);

  // Try every mask, keep the least penalised — that is what makes a code
  // reliably scannable rather than merely valid.
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(base, mask);
    writeFormat(candidate, ecc, mask);
    writeVersion(candidate, version);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { score, mask, matrix: candidate };
  }

  // `reserved` comes back so a decoder can tell function patterns from data.
  // tests.html uses it to read the output back and prove the placement order.
  return {
    size, version, ecc,
    modules: best.matrix.modules,
    reserved: base.reserved,
    mask: best.mask,
  };
}

/** Block structure for a version/ECC pair, so a decoder can de-interleave. */
export function blockStructure(version, ecc) {
  const [ecPerBlock, g1n, g1c, g2n, g2c] = BLOCKS[version][ecc];
  return { ecPerBlock, g1n, g1c, g2n, g2c, dataCodewords: capacity(version, ecc) };
}

export const ECC_LEVEL_BITS = ECC_BITS;

/** Encode as an SVG string. Scales to any label size and prints crisply. */
export function toSvg(text, { ecc = 'M', margin = 4, dark = '#000', light = '#fff' } = {}) {
  const { size, modules } = encode(text, { ecc });
  const dim = size + margin * 2;

  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" `
       + `shape-rendering="crispEdges" role="img">`
       + `<rect width="${dim}" height="${dim}" fill="${light}"/>`
       + `<path d="${path}" fill="${dark}"/></svg>`;
}

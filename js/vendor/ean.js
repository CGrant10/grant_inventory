// EAN-13 / EAN-8 / UPC-A decoder, from a single row of pixels.
//
// Chrome gives us BarcodeDetector; Safari does not, and vendoring a decoder is
// not an option with no build step and no CDN. Product barcodes are 1D and
// genuinely tractable — a scanline, a threshold, and a pattern match.
//
// QR is a different problem (perspective, error correction) and is not attempted
// here: on a phone without BarcodeDetector, the built-in camera app already
// opens a location label's URL, which is a better experience anyway.

// Left-hand odd-parity patterns. R is the complement, G is R reversed.
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const R = L.map(p => [...p].map(b => (b === '0' ? '1' : '0')).join(''));
const G = R.map(p => [...p].reverse().join(''));

// Which of the six left digits use even parity, keyed by the first digit.
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

const GUARD = '101';
const CENTRE = '01010';

/** EAN/UPC check digit: weights alternate 1,3 from the left. */
export function checkDigit(digits) {
  const nums = String(digits).split('').map(Number);
  let sum = 0;
  // The weighting runs 3,1,3,1... backwards from the check digit, which for an
  // even-length body means starting at 3 and for an odd-length body at 1.
  for (let i = nums.length - 1; i >= 0; i--) {
    const weight = (nums.length - 1 - i) % 2 === 0 ? 3 : 1;
    sum += nums[i] * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidBarcode(code) {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$/.test(code)) return false;
  const body = code.slice(0, -1);
  return checkDigit(body) === Number(code.at(-1));
}

/** Render a barcode as a module string, mostly so tests can round-trip it. */
export function encodeEan13(code) {
  if (!/^\d{13}$/.test(code)) throw new Error('EAN-13 needs 13 digits');
  const digits = [...code].map(Number);
  const parity = PARITY[digits[0]];

  let bits = GUARD;
  for (let i = 1; i <= 6; i++) {
    bits += parity[i - 1] === 'L' ? L[digits[i]] : G[digits[i]];
  }
  bits += CENTRE;
  for (let i = 7; i <= 12; i++) bits += R[digits[i]];
  return bits + GUARD;
}

export function encodeEan8(code) {
  if (!/^\d{8}$/.test(code)) throw new Error('EAN-8 needs 8 digits');
  const d = [...code].map(Number);
  let bits = GUARD;
  for (let i = 0; i < 4; i++) bits += L[d[i]];
  bits += CENTRE;
  for (let i = 4; i < 8; i++) bits += R[d[i]];
  return bits + GUARD;
}

/* ---- Decoding ---- */

function matchDigit(chunk, table) {
  const index = table.indexOf(chunk);
  return index === -1 ? null : index;
}

/** Decode a 95-module string as EAN-13. Returns null if it isn't one. */
export function decodeEan13Bits(bits) {
  if (bits.length !== 95) return null;
  if (bits.slice(0, 3) !== GUARD || bits.slice(-3) !== GUARD) return null;
  if (bits.slice(45, 50) !== CENTRE) return null;

  let parity = '';
  const left = [];
  for (let i = 0; i < 6; i++) {
    const chunk = bits.slice(3 + i * 7, 10 + i * 7);
    const asL = matchDigit(chunk, L);
    const asG = matchDigit(chunk, G);
    if (asL !== null) { left.push(asL); parity += 'L'; }
    else if (asG !== null) { left.push(asG); parity += 'G'; }
    else return null;
  }

  const first = PARITY.indexOf(parity);
  if (first === -1) return null;

  const right = [];
  for (let i = 0; i < 6; i++) {
    const digit = matchDigit(bits.slice(50 + i * 7, 57 + i * 7), R);
    if (digit === null) return null;
    right.push(digit);
  }

  const code = `${first}${left.join('')}${right.join('')}`;
  return isValidBarcode(code) ? code : null;
}

/** Decode a 67-module string as EAN-8. */
export function decodeEan8Bits(bits) {
  if (bits.length !== 67) return null;
  if (bits.slice(0, 3) !== GUARD || bits.slice(-3) !== GUARD) return null;
  if (bits.slice(31, 36) !== CENTRE) return null;

  const digits = [];
  for (let i = 0; i < 4; i++) {
    const d = matchDigit(bits.slice(3 + i * 7, 10 + i * 7), L);
    if (d === null) return null;
    digits.push(d);
  }
  for (let i = 0; i < 4; i++) {
    const d = matchDigit(bits.slice(36 + i * 7, 43 + i * 7), R);
    if (d === null) return null;
    digits.push(d);
  }

  const code = digits.join('');
  return isValidBarcode(code) ? code : null;
}

/**
 * Decode one row of luminance samples.
 *
 * @param {Uint8ClampedArray|number[]} row  grayscale, 0-255, left to right
 * @returns {string|null} the barcode digits, or null
 */
export function decodeRow(row) {
  const width = row.length;
  if (width < 100) return null;

  // Threshold at the midpoint of the row's range rather than a fixed value, so
  // it copes with a dim shelf or a bright kitchen window.
  let min = 255, max = 0;
  for (let i = 0; i < width; i++) {
    if (row[i] < min) min = row[i];
    if (row[i] > max) max = row[i];
  }
  if (max - min < 40) return null;               // flat: no barcode here
  const threshold = (min + max) / 2;

  // Run-length encode: alternating widths, starting with whatever colour is at
  // the left edge. 1 = dark (a bar).
  const runs = [];
  let current = row[0] < threshold ? 1 : 0;
  let start = 0;
  for (let i = 1; i <= width; i++) {
    const bit = i < width ? (row[i] < threshold ? 1 : 0) : -1;
    if (bit !== current) {
      runs.push({ bit: current, start, end: i });
      current = bit;
      start = i;
    }
  }

  // A barcode begins with a dark bar. Try every dark run as a candidate start,
  // both left-to-right and reversed, since the phone may be held either way.
  for (const [total, decode] of [[95, decodeEan13Bits], [67, decodeEan8Bits]]) {
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].bit !== 1) continue;

      // The start guard is bar-space-bar of one module each.
      const guard = runs.slice(i, i + 3);
      if (guard.length < 3) break;
      const moduleWidth = (guard[2].end - guard[0].start) / 3;
      if (moduleWidth < 1) continue;

      const span = moduleWidth * total;
      const from = guard[0].start;
      if (from + span > width + moduleWidth) continue;

      // Sample the centre of each module rather than re-deriving run widths;
      // it tolerates a blurry frame far better.
      let bits = '';
      for (let m = 0; m < total; m++) {
        const x = Math.round(from + (m + 0.5) * moduleWidth);
        if (x < 0 || x >= width) { bits = ''; break; }
        bits += row[x] < threshold ? '1' : '0';
      }
      if (bits.length !== total) continue;

      const forward = decode(bits);
      if (forward) return forward;
      const backward = decode([...bits].reverse().join(''));
      if (backward) return backward;
    }
  }
  return null;
}

/**
 * Try several horizontal slices of a frame. A single row often lands on a gap,
 * a glare spot, or the edge of the label.
 *
 * @param {ImageData} image
 * @param {number} slices how many rows to sample across the middle band
 */
export function decodeImage(image, slices = 15) {
  const { width, height, data } = image;
  const row = new Uint8ClampedArray(width);

  for (let s = 0; s < slices; s++) {
    // Spread the samples over the middle 60% — where an aimed barcode sits.
    const y = Math.round(height * (0.2 + 0.6 * (s / Math.max(1, slices - 1))));
    if (y < 0 || y >= height) continue;

    const offset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const p = offset + x * 4;
      // Rec. 601 luma, cheap and good enough for thresholding.
      row[x] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    const hit = decodeRow(row);
    if (hit) return hit;
  }
  return null;
}

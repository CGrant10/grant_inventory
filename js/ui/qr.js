// QR rendering. SVG rather than canvas so labels stay sharp at any print size
// and cost nothing to scale.

import { toSvg } from '../vendor/qr.js';
import { el } from './dom.js';

/**
 * @param {string} text          what the code encodes
 * @param {object} opts
 * @param {number} opts.size     rendered pixel size
 * @param {string} opts.ecc      'L' | 'M' | 'Q' | 'H' — H survives a scuffed label
 */
export function qrElement(text, { size = 160, ecc = 'Q', className = 'qr' } = {}) {
  const wrap = el('div', { class: className, style: `width:${size}px;height:${size}px` });
  try {
    // The SVG is generated here from our own encoder, never from user input
    // directly — the text is encoded into path data, not interpolated as markup.
    wrap.innerHTML = toSvg(text, { ecc });
  } catch (err) {
    wrap.textContent = 'QR too long';
    console.error('[qr]', err);
  }
  return wrap;
}

export { toSvg };

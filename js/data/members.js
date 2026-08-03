import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';

const base = makeRepo('members');

export const memberRepo = {
  ...base,

  /** Register (or rename) this device as a household member. */
  async upsertSelf({ id, name }) {
    const existing = await idb.get('members', id);
    if (existing) return base.update(id, { display_name: name });
    return base.create({ id, display_name: name, color: pickColor(id) });
  },

  async name(id) {
    const m = await idb.get('members', id);
    return m?.display_name || 'Someone';
  },
};

const PALETTE = ['#2fd6a4', '#5fb0ff', '#f5b544', '#ff8fa3', '#b892ff', '#6ee7b7'];

function pickColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Categories. Seeded server-side by supabase/seed.sql, so this is mostly a
// read-through — but a household can add its own without touching SQL.

import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';

const base = makeRepo('categories');

export const categoryRepo = {
  ...base,

  async list() {
    const rows = await idb.all('categories');
    return rows.sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  },

  async create({ name, color = null, icon = null }) {
    const existing = await this.list();
    return base.create({
      name: String(name).trim(),
      color,
      icon,
      sort_order: (existing.at(-1)?.sort_order ?? 0) + 10,
    });
  },

  /** id -> row, for labelling lists without a lookup per item. */
  async map() {
    return new Map((await this.list()).map(c => [c.id, c]));
  },
};

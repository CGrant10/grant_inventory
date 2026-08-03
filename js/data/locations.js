// Places: rooms, shelves, bins, totes — a tree, because that is how a house is
// actually organised. "Kitchen › Pantry › Shelf 2 › Bin A" is one row with a
// parent_id chain, not four columns.

import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';
import { slug } from '../core/model.js';

const base = makeRepo('locations');

export const locationRepo = {
  ...base,

  async create({ name, kind = 'other', parent_id = null, notes = null }) {
    const siblings = await this.children(parent_id);
    return base.create({
      name: String(name).trim(),
      kind,
      parent_id,
      notes,
      qr_slug: slug(name),
      sort_order: siblings.length,
    });
  },

  async children(parentId = null) {
    const all = await idb.all('locations');
    return all
      .filter(l => (l.parent_id ?? null) === (parentId ?? null))
      .sort(byOrderThenName);
  },

  async roots() {
    return this.children(null);
  },

  async bySlug(qrSlug) {
    const [hit] = await idb.where('locations', 'qr_slug', qrSlug);
    return hit ?? null;
  },

  /** Ancestors, outermost first, excluding the location itself. */
  async ancestors(id) {
    const all = await idb.all('locations');
    const byId = new Map(all.map(l => [l.id, l]));
    const chain = [];
    let node = byId.get(id);
    const guard = new Set();               // a corrupt parent chain must not hang the UI
    while (node?.parent_id && !guard.has(node.parent_id)) {
      guard.add(node.parent_id);
      node = byId.get(node.parent_id);
      if (!node) break;
      chain.unshift(node);
    }
    return chain;
  },

  async path(id, separator = ' › ') {
    const chain = await this.ancestors(id);
    const self = await idb.get('locations', id);
    return [...chain, self].filter(Boolean).map(l => l.name).join(separator);
  },

  /** The location and everything nested beneath it. */
  async subtree(id) {
    const all = await idb.all('locations');
    const byParent = new Map();
    for (const l of all) {
      const key = l.parent_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(l);
    }
    const out = [];
    const walk = nodeId => {
      for (const child of (byParent.get(nodeId) ?? []).sort(byOrderThenName)) {
        out.push(child);
        walk(child.id);
      }
    };
    walk(id);
    return out;
  },

  /** Flat list in display order, each tagged with its depth. */
  async flatTree() {
    const all = await idb.all('locations');
    const byParent = new Map();
    for (const l of all) {
      const key = l.parent_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(l);
    }
    const out = [];
    const walk = (parentId, depth) => {
      for (const node of (byParent.get(parentId) ?? []).sort(byOrderThenName)) {
        out.push({ ...node, depth });
        walk(node.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  },

  /** Direct item count, and the count including everything nested. */
  async counts(id) {
    const [direct, nested] = await Promise.all([
      idb.where('items', 'location_id', id),
      this.subtree(id),
    ]);
    const nestedIds = nested.map(l => l.id);
    const all = await idb.all('items');
    const deep = all.filter(i => nestedIds.includes(i.location_id)).length;
    return { direct: direct.length, total: direct.length + deep, children: nested.length };
  },

  /**
   * Reparent. Refuses to put a location inside its own subtree, which would
   * orphan the branch from the root and make it unreachable in the UI.
   */
  async move(id, newParentId) {
    if (id === newParentId) throw new Error('A place cannot be inside itself.');
    if (newParentId) {
      const descendants = await this.subtree(id);
      if (descendants.some(l => l.id === newParentId)) {
        throw new Error('That would put this place inside one of its own shelves.');
      }
    }
    return base.update(id, { parent_id: newParentId ?? null });
  },

  /**
   * Soft delete, but only when empty. Cascading would silently hide items the
   * user still owns; better to say what is in the way.
   */
  async remove(id) {
    const { direct, children } = await this.counts(id);
    if (children) throw new Error(`Move or delete the ${children} place${children === 1 ? '' : 's'} inside first.`);
    if (direct) throw new Error(`There ${direct === 1 ? 'is' : 'are'} still ${direct} item${direct === 1 ? '' : 's'} here.`);
    return base.softDelete(id);
  },

  /** The URL a printed QR label points at. */
  url(location) {
    const base = location_base();
    return `${base}#/l/${location.qr_slug}`;
  },
};

function location_base() {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/[^/]*$/, '');
}

function byOrderThenName(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);
}

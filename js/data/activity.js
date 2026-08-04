// The household activity feed.
//
// Two append-only logs already exist — item_events and maintenance_log — so this
// merges rather than records. Nothing new is written to build the feed, which
// means it can never disagree with the item histories it is drawn from.

import * as idb from '../core/idb.js';
import { fmtQty } from './items.js';

const ITEM_VERB = {
  add: 'added', consume: 'used', restock: 'restocked', adjust: 'adjusted',
  move: 'moved', discard: 'removed', expire: 'threw out',
};

/**
 * @param {number} limit  how many entries to return, newest first
 * @returns {Promise<Array<{id,at,who,text,detail,delta,kind}>>}
 */
export async function feed(limit = 100) {
  const [events, log, items, tasks, members, locations] = await Promise.all([
    idb.all('item_events', { includeDeleted: true }),
    idb.all('maintenance_log', { includeDeleted: true }).catch(() => []),
    idb.all('items', { includeDeleted: true }),
    idb.all('maintenance_tasks', { includeDeleted: true }).catch(() => []),
    idb.all('members'),
    idb.all('locations', { includeDeleted: true }),
  ]);

  const itemName = new Map(items.map(i => [i.id, i.name]));
  const taskName = new Map(tasks.map(t => [t.id, t.name]));
  const placeName = new Map(locations.map(l => [l.id, l.name]));
  const who = new Map(members.map(m => [m.id, m.display_name]));

  const entries = [];

  for (const e of events) {
    const name = itemName.get(e.item_id);
    if (!name) continue;                     // an item purged entirely
    const delta = Number(e.delta ?? 0);

    let text = `${ITEM_VERB[e.type] ?? e.type} ${name}`;
    if (e.type === 'move') {
      const to = placeName.get(e.to_location_id);
      text = to ? `moved ${name} to ${to}` : `moved ${name}`;
    }

    entries.push({
      id: e.id,
      at: e.created_at,
      who: who.get(e.member_id) ?? 'Someone',
      kind: e.type,
      text,
      detail: e.note ?? null,
      delta: delta || null,
      href: `#/item/${e.item_id}`,
    });
  }

  for (const l of log) {
    const name = taskName.get(l.task_id);
    if (!name) continue;
    entries.push({
      id: l.id,
      // The log records the day it was done; sort with the others by using it
      // as a timestamp, falling back to when the row was written.
      at: l.created_at ?? `${l.done_on}T12:00:00.000Z`,
      who: who.get(l.member_id) ?? 'Someone',
      kind: 'maintenance',
      text: `did ${name}`,
      detail: l.note ?? null,
      delta: null,
      href: '#/maintenance',
    });
  }

  return entries
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit);
}

/** Entries grouped under Today / Yesterday / a date. */
export function groupByDay(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = String(entry.at).slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.entries()].map(([day, list]) => ({ day, label: dayLabel(day), list }));
}

function dayLabel(iso) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const asKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (iso === asKey(today)) return 'Today';
  if (iso === asKey(yesterday)) return 'Yesterday';

  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined,
    { weekday: 'short', day: 'numeric', month: 'short' });
}

export function deltaLabel(delta) {
  if (!delta) return null;
  return delta > 0 ? `+${fmtQty(delta)}` : fmtQty(delta);
}

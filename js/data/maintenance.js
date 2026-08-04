// Household maintenance: the jobs on a cycle.
//
// Furnace filter every six months, smoke alarm batteries every year, gutters
// twice a year. The app's job is to know when each is next due and to make
// "did it" one tap — which, when the job consumes something you stock, also
// takes one off the shelf.

import { makeRepo, queueUpsert } from './base.js';
import * as idb from '../core/idb.js';
import { itemRepo } from './items.js';
import { device } from '../core/auth.js';
import { uuid, nowIso, addInterval, today, daysBetween } from '../core/model.js';
import { emit, EVENTS } from '../core/bus.js';

const base = makeRepo('maintenance_tasks');

export const maintenanceRepo = {
  ...base,

  async list() {
    const rows = await idb.all('maintenance_tasks');
    // Soonest first, and anything without a date last — it has never been done.
    return rows.sort((a, b) =>
      (a.next_due_on ?? '9999-12-31').localeCompare(b.next_due_on ?? '9999-12-31'));
  },

  async create({ name, interval_value = 6, interval_unit = 'month', notes = null,
                 location_id = null, item_id = null, consume_quantity = 1,
                 last_done_on = null }) {
    // Never done before? Treat it as due now rather than inventing a history —
    // the point is to surface it, not to pretend it was handled.
    const next = last_done_on
      ? addInterval(last_done_on, interval_value, interval_unit)
      : today();

    return base.create({
      name: String(name).trim(),
      notes,
      location_id,
      item_id,
      consume_quantity: Number(consume_quantity) || 1,
      interval_value: Number(interval_value) || 1,
      interval_unit,
      last_done_on,
      next_due_on: next,
    });
  },

  /** Editing the schedule re-dates the next occurrence from the last one done. */
  async update(id, patch) {
    const current = await idb.get('maintenance_tasks', id);
    if (!current) throw new Error('Task not found');

    const merged = { ...current, ...patch };
    const scheduleChanged = patch.interval_value !== undefined
                         || patch.interval_unit !== undefined
                         || patch.last_done_on !== undefined;

    if (scheduleChanged) {
      merged.next_due_on = merged.last_done_on
        ? addInterval(merged.last_done_on, merged.interval_value, merged.interval_unit)
        : today();
    }
    return base.update(id, merged);
  },

  /**
   * Mark it done. Rolls the schedule forward from the day it was actually done,
   * writes an entry to the log, and uses up the linked stock if there is any.
   */
  async complete(id, { on = today(), note = null } = {}) {
    const task = await idb.get('maintenance_tasks', id);
    if (!task) throw new Error('Task not found');

    const entry = {
      id: uuid(),
      task_id: id,
      done_on: on,
      member_id: device().id,
      note,
      created_at: nowIso(),
    };
    await idb.put('maintenance_log', entry);
    await queueUpsert('maintenance_log', entry);

    let consumed = null;
    if (task.item_id) {
      const item = await itemRepo.get(task.item_id);
      if (item && !item.deleted_at) {
        const { item: updated } = await itemRepo.adjustBy(
          task.item_id, -(Number(task.consume_quantity) || 1), 'consume',
          `maintenance: ${task.name}`);
        consumed = updated;
      }
    }

    const saved = await base.update(id, {
      last_done_on: on,
      next_due_on: addInterval(on, task.interval_value, task.interval_unit),
    });

    emit(EVENTS.DATA_CHANGED, { table: 'maintenance_tasks', source: 'local' });
    return { task: saved, consumed, entry };
  },

  /** Push the next occurrence out without claiming it was done. */
  async snooze(id, days = 7) {
    const task = await idb.get('maintenance_tasks', id);
    if (!task) throw new Error('Task not found');
    const from = task.next_due_on ?? today();
    return base.update(id, { next_due_on: addInterval(from, days, 'day') });
  },

  async history(id, limit = 20) {
    const rows = await idb.where('maintenance_log', 'task_id', id);
    return rows
      .sort((a, b) => String(b.done_on).localeCompare(String(a.done_on)))
      .slice(0, limit);
  },

  async remove(id) {
    return base.softDelete(id);
  },
};

/** How a task stands right now. */
export function dueState(task, soonDays = 14) {
  if (!task.next_due_on) return { state: 'unknown', days: null };
  const days = daysBetween(today(), task.next_due_on);
  if (days < 0) return { state: 'overdue', days };
  if (days === 0) return { state: 'today', days };
  if (days <= soonDays) return { state: 'soon', days };
  return { state: 'later', days };
}

export function dueLabel(task) {
  const { state, days } = dueState(task);
  if (state === 'unknown') return 'No date set';
  if (state === 'overdue') {
    const late = Math.abs(days);
    return late === 1 ? '1 day overdue' : `${late} days overdue`;
  }
  if (state === 'today') return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 45) return `Due in ${days} days`;
  const months = Math.round(days / 30);
  return `Due in about ${months} month${months === 1 ? '' : 's'}`;
}

export function intervalLabel(task) {
  const n = Number(task.interval_value) || 1;
  const unit = task.interval_unit;
  if (n === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[unit] ?? `Every ${unit}`;
  return `Every ${n} ${unit}s`;
}

/** Anything overdue or due today — what the dashboard should shout about. */
export async function dueNow() {
  const rows = await maintenanceRepo.list();
  return rows.filter(t => ['overdue', 'today'].includes(dueState(t).state));
}

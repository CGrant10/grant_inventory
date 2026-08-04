// Measurements: the numbers you always need and never have with you.
//
// A measurement is a subject ("Kitchen window over the sink") with an open set
// of named dimensions. Open, because a window has a sill depth and a room has a
// ceiling height and no fixed set of columns survives contact with a house.

import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';
import { uuid, nowIso } from '../core/model.js';
import { queueUpsert } from './base.js';
import { emit, EVENTS } from '../core/bus.js';

const base = makeRepo('measurements');
const dims = makeRepo('measurement_dims');

export const measurementRepo = {
  ...base,

  async list() {
    const rows = await idb.all('measurements');
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },

  async create({ name, subject_kind = 'other', location_id = null, notes = null, dimensions = [] }) {
    const row = await base.create({
      name: String(name).trim(),
      subject_kind,
      location_id,
      notes,
    });
    let order = 0;
    for (const d of dimensions) {
      if (d.value === '' || d.value == null) continue;
      await this.addDimension(row.id, { ...d, sort_order: order++ });
    }
    return row;
  },

  async addDimension(measurementId, { label, value, unit = 'in', sort_order = 0 }) {
    return dims.create({
      measurement_id: measurementId,
      label: String(label).trim(),
      value: Number(value),
      unit,
      sort_order,
    });
  },

  updateDimension(id, patch) { return dims.update(id, patch); },
  removeDimension(id) { return dims.softDelete(id); },

  async dimensions(measurementId) {
    const rows = await idb.where('measurement_dims', 'measurement_id', measurementId);
    return rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  },

  /** Every measurement with its dimensions attached, for list rendering. */
  async withDimensions() {
    const [rows, allDims] = await Promise.all([
      this.list(),
      idb.all('measurement_dims'),
    ]);
    const byMeasurement = new Map();
    for (const d of allDims) {
      if (!byMeasurement.has(d.measurement_id)) byMeasurement.set(d.measurement_id, []);
      byMeasurement.get(d.measurement_id).push(d);
    }
    return rows.map(m => ({
      ...m,
      dims: (byMeasurement.get(m.id) ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }));
  },

  /** Delete the subject and its dimensions together — orphans help nobody. */
  async remove(id) {
    for (const d of await this.dimensions(id)) await dims.softDelete(d.id);
    return base.softDelete(id);
  },
};

/** "36 × 84 in" — the shorthand you'd actually say out loud. */
export function summarise(dimensions) {
  if (!dimensions?.length) return 'No dimensions yet';
  const unit = dimensions[0].unit || '';
  const sameUnit = dimensions.every(d => (d.unit || '') === unit);
  const numbers = dimensions.map(d => fmtNumber(d.value)).join(' × ');
  return sameUnit ? `${numbers} ${unit}`.trim()
                  : dimensions.map(d => `${fmtNumber(d.value)} ${d.unit}`).join(' × ');
}

export function fmtNumber(value) {
  const n = Number(value ?? 0);
  if (Number.isInteger(n)) return String(n);
  // Tape measures stop at sixteenths; three decimals is already more than real.
  return String(Number(n.toFixed(3)));
}

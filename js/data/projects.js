// Projects: the things you intend to do to the house.
//
// A project is a title, a status, and a list of lines — materials to buy, tools
// to borrow, tasks to do. Costs roll up from the lines so the estimate stays
// honest as the list grows, rather than being a number typed once and forgotten.

import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';
import { PROJECT_STATUSES } from '../core/model.js';

const base = makeRepo('projects');
const lines = makeRepo('project_lines');

const ORDER = PROJECT_STATUSES.map(s => s.id);

export const projectRepo = {
  ...base,

  async list() {
    const rows = await idb.all('projects');
    return rows.sort((a, b) =>
      ORDER.indexOf(a.status) - ORDER.indexOf(b.status)
      || (b.priority ?? 0) - (a.priority ?? 0)
      || a.title.localeCompare(b.title));
  },

  create({ title, status = 'idea', description = null, target_date = null, est_cost = null }) {
    return base.create({
      title: String(title).trim(),
      status,
      description,
      target_date: target_date || null,
      est_cost: est_cost == null || est_cost === '' ? null : Number(est_cost),
      actual_cost: null,
      priority: 0,
    });
  },

  setStatus(id, status) { return base.update(id, { status }); },

  /* ---- Lines ---- */

  async lines(projectId) {
    const rows = await idb.where('project_lines', 'project_id', projectId);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },

  addLine(projectId, { kind = 'material', name, quantity = 1, unit = 'ea',
                       est_cost = null, item_id = null, measurement_id = null }) {
    return lines.create({
      project_id: projectId,
      kind,
      name: String(name).trim(),
      quantity: Number(quantity) || 1,
      unit,
      est_cost: est_cost === '' || est_cost == null ? null : Number(est_cost),
      done: false,
      item_id,
      measurement_id,
    });
  },

  updateLine(id, patch) { return lines.update(id, patch); },
  removeLine(id) { return lines.softDelete(id); },

  async toggleLine(id) {
    const row = await idb.get('project_lines', id);
    return lines.update(id, { done: !row.done });
  },

  /** Delete the project and its lines together. */
  async remove(id) {
    for (const line of await this.lines(id)) await lines.softDelete(line.id);
    return base.softDelete(id);
  },

  /**
   * Cost and progress. The estimate typed on the project is only used when there
   * are no lines to add up — once there are, the lines are the better answer.
   */
  async summary(projectId) {
    const rows = await this.lines(projectId);
    const project = await idb.get('projects', projectId);

    const lineTotal = rows.reduce(
      (sum, l) => sum + (Number(l.est_cost) || 0) * (Number(l.quantity) || 1), 0);
    const done = rows.filter(l => l.done).length;

    return {
      lines: rows.length,
      done,
      remaining: rows.length - done,
      progress: rows.length ? done / rows.length : 0,
      estimate: rows.some(l => l.est_cost != null) ? lineTotal : (Number(project?.est_cost) || 0),
      fromLines: rows.some(l => l.est_cost != null),
    };
  },
};

export function money(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });
}

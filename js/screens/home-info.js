// "House" tab — everything about the building rather than its contents.

import { el, icon, ICONS } from '../ui/dom.js';
import * as idb from '../core/idb.js';

export default async function homeInfo() {
  const [locations, measurements, projects, maintenance] = await Promise.all([
    idb.all('locations'),
    idb.all('measurements'),
    idb.all('projects'),
    idb.all('maintenance_tasks'),
  ]);

  const { dueState } = await import('../data/maintenance.js');
  const due = maintenance.filter(t => ['overdue', 'today'].includes(dueState(t).state));

  const active = projects.filter(p => p.status === 'active' || p.status === 'planned');

  return el('div', { class: 'stack' }, [
    el('div', { class: 'list' }, [
      hub('Places', `${locations.length} rooms, shelves and bins`, ICONS.pin, '#/locations'),
      hub('Measurements', `${measurements.length} recorded`, ICONS.ruler, '#/measurements'),
      hub('Maintenance',
          due.length ? `${due.length} due now` : maintenance.length ? `${maintenance.length} scheduled` : 'Nothing scheduled',
          ICONS.clock, '#/maintenance'),
      hub('Projects', active.length ? `${active.length} in progress` : 'Nothing planned yet', ICONS.hammer, '#/projects'),
    ]),
  ]);
}

function hub(title, sub, glyph, href) {
  return el('a', { class: 'row', href }, [
    el('span', { class: 'row-icon' }, [icon(glyph, 22)]),
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: title }),
      el('div', { class: 'row-sub', text: sub }),
    ]),
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}

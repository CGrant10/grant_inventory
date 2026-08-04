// One project: what it will take, what it will cost, and what is left.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { projectRepo, money } from '../data/projects.js';
import { projectForm } from './projects.js';
import { measurementRepo, summarise } from '../data/measurements.js';
import { PROJECT_STATUSES, LINE_KINDS, UNITS } from '../core/model.js';
import { sheet, close, confirmSheet } from '../ui/sheet.js';
import { toast, errorToast } from '../ui/toast.js';
import { go, refresh } from '../core/router.js';
import * as idb from '../core/idb.js';

const KIND_LABEL = Object.fromEntries(LINE_KINDS.map(k => [k.id, k.label]));

export default async function project({ id }) {
  const row = await idb.get('projects', id);
  if (!row || row.deleted_at) {
    return empty({
      glyph: ICONS.warn,
      title: 'That project is gone',
      body: 'It was deleted, or this phone has not synced yet.',
      action: el('a', { class: 'btn', href: '#/projects', text: 'All projects' }),
    });
  }

  const [lines, summary, allMeasurements] = await Promise.all([
    projectRepo.lines(row.id),
    projectRepo.summary(row.id),
    measurementRepo.withDimensions(),
  ]);
  const measurementById = new Map(allMeasurements.map(m => [m.id, m]));

  const statusRow = el('div', { class: 'chip-row' }, PROJECT_STATUSES.map(s =>
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(s.id === row.status), text: s.label,
      onclick: async () => { await projectRepo.setStatus(row.id, s.id); refresh(); },
    })));

  const byKind = LINE_KINDS
    .map(k => [k, lines.filter(l => l.kind === k.id)])
    .filter(([, list]) => list.length);

  return el('div', { class: 'stack' }, [
    el('div', { class: 'place-head' }, [
      el('div', {}, [
        el('h2', { class: 'place-name', text: row.title }),
        el('div', { class: 'row-sub', text: row.target_date ? `Target ${row.target_date}` : 'No target date' }),
      ]),
      el('button', {
        class: 'icon-btn', 'aria-label': 'Edit project',
        onclick: () => projectForm({ project: row, onDone: refresh }),
      }, [icon('<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>', 22)]),
    ]),

    statusRow,

    el('div', { class: 'stat-grid' }, [
      stat('Lines', String(summary.lines)),
      stat('Done', String(summary.done)),
      stat('Left', String(summary.remaining)),
      stat('Cost', summary.estimate ? money(summary.estimate) : '—'),
    ]),
    summary.fromLines
      ? el('p', { class: 'help', text: 'Cost added up from the lines below.' })
      : null,

    row.description ? el('p', { class: 'help selectable', text: row.description }) : null,

    ...byKind.map(([kind, list]) => el('div', {}, [
      el('div', { class: 'section-title', text: `${kind.label}s (${list.filter(l => l.done).length}/${list.length})` }),
      el('div', { class: 'list' }, list.map(l => lineRow(l, measurementById))),
    ])),

    lines.length ? null : el('p', { class: 'help', text: 'Nothing listed yet. Add what it will take.' }),

    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => lineForm({ projectId: row.id, measurements: allMeasurements }),
    }, [icon(ICONS.plus, 20), el('span', { text: 'Add a material, tool or task' })]),

    el('button', {
      class: 'btn btn-danger btn-block',
      text: 'Delete project',
      onclick: async () => {
        const ok = await confirmSheet({
          title: `Delete ${row.title}?`,
          message: 'Everything listed under it goes too, on every phone.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        await projectRepo.remove(row.id);
        toast('Deleted');
        go('/projects', { replace: true });
      },
    }),
  ]);
}

function stat(label, value) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-value', text: value }),
    el('div', { class: 'stat-label', text: label }),
  ]);
}

function lineRow(line, measurementById) {
  const measurement = line.measurement_id ? measurementById.get(line.measurement_id) : null;
  const bits = [
    `${line.quantity} ${line.unit || ''}`.trim(),
    line.est_cost != null ? money(Number(line.est_cost) * (Number(line.quantity) || 1)) : null,
    measurement ? `${measurement.name}: ${summarise(measurement.dims)}` : null,
  ].filter(Boolean);

  return el('div', { class: `row shop-row${line.done ? ' is-done' : ''}` }, [
    el('button', {
      class: `tickbox ${line.done ? 'is-bought' : ''}`,
      type: 'button',
      'aria-label': line.done ? 'Mark not done' : 'Mark done',
      onclick: async () => { await projectRepo.toggleLine(line.id); refresh(); },
    }, line.done ? [icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 20)] : []),
    el('button', { class: 'row-main shop-main', onclick: () => editLine(line) }, [
      el('div', { class: 'row-title', text: line.name }),
      el('div', { class: 'row-sub', text: bits.join(' · ') }),
    ]),
  ]);
}

function lineForm({ projectId, measurements }) {
  let kind = 'material';

  const name = el('input', { class: 'field', type: 'text', placeholder: '2×4, drill, sand the floor', autocapitalize: 'sentences' });
  const qty = el('input', { class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: '1' });
  const unit = el('select', { class: 'field' }, UNITS.map(u => el('option', { value: u, text: u })));
  const cost = el('input', { class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: 'Cost each (optional)' });

  // Attaching a measurement is the point of having measurements at all: the
  // number travels with the shopping line to the shop.
  const measurement = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'No measurement attached' }),
    ...measurements.map(m => el('option', { value: m.id, text: `${m.name} — ${summarise(m.dims)}` })),
  ]);

  const kindRow = el('div', { class: 'chip-row' }, LINE_KINDS.map(k =>
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(k.id === kind), text: k.label,
      onclick: e => {
        kind = k.id;
        for (const chip of e.currentTarget.parentElement.children) {
          chip.setAttribute('aria-pressed', String(chip === e.currentTarget));
        }
      },
    })));

  const save = async () => {
    const trimmed = name.value.trim();
    if (!trimmed) return errorToast('Give it a name.');
    await projectRepo.addLine(projectId, {
      kind, name: trimmed,
      quantity: Number(qty.value) || 1,
      unit: unit.value,
      est_cost: cost.value === '' ? null : Number(cost.value),
      measurement_id: measurement.value || null,
    });
    close();
    refresh();
  };

  name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

  sheet({
    title: 'Add to the project',
    body: el('div', { class: 'stack-sm' }, [
      kindRow,
      name,
      el('div', { class: 'field-pair' }, [qty, unit]),
      cost,
      measurement,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'Add', onclick: save }),
    ],
  });
}

function editLine(line) {
  const qty = el('input', { class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: String(line.quantity) });
  const cost = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any',
    value: line.est_cost ?? '', placeholder: 'Cost each',
  });

  sheet({
    title: line.name,
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: `How many ${line.unit || ''}?`.trim() }),
      qty,
      el('label', { class: 'field-label', text: 'Cost each' }),
      cost,
      el('p', { class: 'help', text: `${KIND_LABEL[line.kind] ?? 'Line'} on this project.` }),
    ]),
    actions: [
      el('button', {
        class: 'btn btn-danger btn-block', text: 'Remove',
        onclick: async () => { await projectRepo.removeLine(line.id); close(); refresh(); },
      }),
      el('button', {
        class: 'btn btn-primary btn-block', text: 'Save',
        onclick: async () => {
          await projectRepo.updateLine(line.id, {
            quantity: Number(qty.value) || 1,
            est_cost: cost.value === '' ? null : Number(cost.value),
          });
          close();
          refresh();
        },
      }),
    ],
  });
}

// Household maintenance. Overdue at the top, in red, because that is the only
// part that needs acting on today.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { maintenanceRepo, dueState, dueLabel, intervalLabel } from '../data/maintenance.js';
import { MAINTENANCE_PRESETS, INTERVAL_UNITS, today } from '../core/model.js';
import { locationRepo } from '../data/locations.js';
import { itemRepo, fmtQty } from '../data/items.js';
import { sheet, close, confirmSheet } from '../ui/sheet.js';
import { toast, errorToast } from '../ui/toast.js';
import { refresh } from '../core/router.js';
import * as idb from '../core/idb.js';

const GROUPS = [
  { key: 'overdue', title: 'Overdue', tone: 'danger' },
  { key: 'today',   title: 'Due today', tone: 'warn' },
  { key: 'soon',    title: 'Coming up', tone: 'warn' },
  { key: 'later',   title: 'Later', tone: null },
  { key: 'unknown', title: 'No date', tone: null },
];

export default async function maintenance() {
  const [tasks, places, items] = await Promise.all([
    maintenanceRepo.list(),
    locationRepo.flatTree(),
    itemRepo.all(),
  ]);
  const placeName = new Map(places.map(p => [p.id, p.name]));
  const itemById = new Map(items.map(i => [i.id, i]));

  const addButton = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => taskForm({ places, items }),
  }, [icon(ICONS.plus, 20), el('span', { text: 'Add a maintenance job' })]);

  if (!tasks.length) {
    return el('div', { class: 'stack' }, [
      empty({
        glyph: ICONS.clock,
        title: 'Nothing scheduled',
        body: 'Furnace filter every six months, smoke alarm batteries once a year, '
            + 'gutters each spring — the jobs that are easy to forget until they matter.',
      }),
      addButton,
    ]);
  }

  const sections = GROUPS
    .map(g => [g, tasks.filter(t => dueState(t).state === g.key)])
    .filter(([, list]) => list.length)
    .map(([g, list]) => el('div', {}, [
      el('div', { class: 'section-title', text: `${g.title} (${list.length})` }),
      el('div', { class: 'list' }, list.map(t => row(t, { placeName, itemById, places, items }))),
    ]));

  return el('div', { class: 'stack' }, [...sections, addButton]);
}

function row(task, ctx) {
  const { state } = dueState(task);
  const tone = state === 'overdue' ? 'danger' : (state === 'today' || state === 'soon') ? 'warn' : null;
  const linked = task.item_id ? ctx.itemById.get(task.item_id) : null;

  const bits = [
    intervalLabel(task),
    ctx.placeName.get(task.location_id),
    linked ? `uses ${fmtQty(task.consume_quantity)} ${linked.name}` : null,
  ].filter(Boolean);

  return el('div', { class: 'row maint-row' }, [
    el('button', {
      class: 'btn btn-primary maint-done',
      type: 'button',
      title: 'Mark done today',
      onclick: () => markDone(task, linked),
    }, [icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 20)]),

    el('button', { class: 'row-main maint-main', onclick: () => taskForm({ task, ...ctx }) }, [
      el('div', { class: 'row-title', text: task.name }),
      el('div', { class: 'row-sub' }, [
        el('span', { class: tone ? `badge badge-${tone}` : 'due-plain', text: dueLabel(task) }),
        el('span', { text: bits.join(' · ') }),
      ]),
    ]),
  ]);
}

async function markDone(task, linked) {
  try {
    const { consumed } = await maintenanceRepo.complete(task.id);
    const fresh = await idb.get('maintenance_tasks', task.id);
    toast(consumed
      ? `Done. ${consumed.name} down to ${fmtQty(consumed.quantity)} · next ${fresh.next_due_on}`
      : `Done. Next due ${fresh.next_due_on}`, { ms: 6000 });
    refresh();
  } catch (err) {
    errorToast(err.message);
  }
}

function taskForm({ task = null, places = [], items = [] }) {
  const editing = Boolean(task);

  const name = el('input', {
    class: 'field', type: 'text', value: task?.name ?? '',
    placeholder: 'Change the furnace filter', autocapitalize: 'sentences',
  });

  let value = task?.interval_value ?? 6;
  let unit = task?.interval_unit ?? 'month';

  const every = el('input', {
    class: 'field', type: 'number', inputmode: 'numeric', min: '1', step: '1',
    value: String(value),
  });
  const unitSelect = el('select', { class: 'field' },
    INTERVAL_UNITS.map(u => el('option', { value: u.id, text: u.label })));
  unitSelect.value = unit;

  const presets = el('div', { class: 'chip-row' }, MAINTENANCE_PRESETS.map(p =>
    el('button', {
      class: 'chip', type: 'button', text: p.label,
      onclick: () => { every.value = String(p.value); unitSelect.value = p.unit; },
    })));

  const lastDone = el('input', {
    class: 'field', type: 'date', value: task?.last_done_on ?? '',
  });

  const place = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'Anywhere in particular?' }),
    ...places.map(p => el('option', { value: p.id, text: `${'— '.repeat(p.depth)}${p.name}` })),
  ]);
  place.value = task?.location_id ?? '';

  // Linking to stock is what makes this more than a calendar: doing the job
  // takes the filter off the shelf, which can put it on the shopping list.
  const item = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'Uses nothing from inventory' }),
    ...items.map(i => el('option', { value: i.id, text: `${i.name} (${fmtQty(i.quantity)} ${i.unit || ''})`.trim() })),
  ]);
  item.value = task?.item_id ?? '';

  const consume = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any',
    value: String(task?.consume_quantity ?? 1),
  });

  const notes = el('textarea', { class: 'field', rows: 2, placeholder: 'Notes — filter size, which valve, that sort of thing' });
  notes.value = task?.notes ?? '';

  const save = async () => {
    const trimmed = name.value.trim();
    if (!trimmed) return errorToast('Give the job a name.');

    const fields = {
      name: trimmed,
      interval_value: Math.max(1, Number(every.value) || 1),
      interval_unit: unitSelect.value,
      last_done_on: lastDone.value || null,
      location_id: place.value || null,
      item_id: item.value || null,
      consume_quantity: Number(consume.value) || 1,
      notes: notes.value.trim() || null,
    };

    try {
      if (editing) await maintenanceRepo.update(task.id, fields);
      else await maintenanceRepo.create(fields);
      close();
      toast(editing ? 'Saved' : `Scheduled ${trimmed}`);
      refresh();
    } catch (err) {
      errorToast(err.message);
    }
  };

  sheet({
    title: editing ? 'Edit job' : 'New maintenance job',
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: 'What needs doing?' }),
      name,
      el('label', { class: 'field-label', text: 'How often?' }),
      presets,
      el('div', { class: 'field-pair' }, [every, unitSelect]),
      el('label', { class: 'field-label', text: 'Last done (leave blank if never)' }),
      lastDone,
      el('label', { class: 'field-label', text: 'Uses up' }),
      item,
      consume,
      el('label', { class: 'field-label', text: 'Where?' }),
      place,
      notes,
      editing ? el('div', { class: 'stack-sm' }, [
        el('button', {
          class: 'btn btn-ghost btn-block', type: 'button', text: 'Push back a week',
          onclick: async () => { await maintenanceRepo.snooze(task.id, 7); close(); toast('Pushed back a week'); refresh(); },
        }),
        el('button', {
          class: 'btn btn-danger btn-block', type: 'button', text: 'Delete job',
          onclick: async () => {
            close();
            const ok = await confirmSheet({
              title: `Delete ${task.name}?`,
              message: 'It stops appearing on every phone. The history is kept.',
              confirmLabel: 'Delete', danger: true,
            });
            if (!ok) return;
            await maintenanceRepo.remove(task.id);
            toast('Deleted');
            refresh();
          },
        }),
      ]) : null,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary btn-block', text: editing ? 'Save' : 'Schedule it', onclick: save }),
    ],
  });
}

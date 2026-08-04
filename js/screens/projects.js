// Projects, grouped by where they stand. Ideas at the bottom, work in progress
// at the top — the list should answer "what am I doing" before "what might I do".

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { projectRepo, money } from '../data/projects.js';
import { PROJECT_STATUSES } from '../core/model.js';
import { sheet, close } from '../ui/sheet.js';
import { toast, errorToast } from '../ui/toast.js';
import { refresh } from '../core/router.js';
import * as idb from '../core/idb.js';

const LABEL = Object.fromEntries(PROJECT_STATUSES.map(s => [s.id, s.label]));
// Active first: the list should open on what is actually happening.
const GROUPS = ['active', 'blocked', 'planned', 'idea', 'done'];

export default async function projects() {
  const rows = await projectRepo.list();
  const summaries = new Map(
    await Promise.all(rows.map(async p => [p.id, await projectRepo.summary(p.id)])));

  const addButton = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => projectForm({}),
  }, [icon(ICONS.plus, 20), el('span', { text: 'New project' })]);

  if (!rows.length) {
    return el('div', { class: 'stack' }, [
      empty({
        glyph: ICONS.hammer,
        title: 'No projects yet',
        body: 'The shelf you keep meaning to build, the room that needs painting. '
            + 'Park the idea here with what it will take.',
      }),
      addButton,
    ]);
  }

  const sections = GROUPS
    .map(status => [status, rows.filter(p => p.status === status)])
    .filter(([, list]) => list.length)
    .map(([status, list]) => el('div', {}, [
      el('div', { class: 'section-title', text: `${LABEL[status]} (${list.length})` }),
      el('div', { class: 'list' }, list.map(p => row(p, summaries.get(p.id)))),
    ]));

  return el('div', { class: 'stack' }, [...sections, addButton]);
}

function row(project, summary) {
  const bits = [];
  if (summary.lines) bits.push(`${summary.done}/${summary.lines} done`);
  if (summary.estimate) bits.push(money(summary.estimate));
  if (project.target_date) bits.push(project.target_date);

  return el('a', { class: 'row', href: `#/project/${project.id}` }, [
    el('span', { class: 'row-icon' }, [icon(ICONS.hammer, 20)]),
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: project.title }),
      el('div', { class: 'row-sub', text: bits.join(' · ') || 'No details yet' }),
    ]),
    summary.lines
      ? el('span', { class: 'progress-ring', style: `--p:${Math.round(summary.progress * 100)}` })
      : null,
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}

export function projectForm({ project = null, onDone } = {}) {
  const editing = Boolean(project);

  const title = el('input', {
    class: 'field', type: 'text', value: project?.title ?? '',
    placeholder: 'Build pantry shelving', autocapitalize: 'sentences',
  });
  const description = el('textarea', { class: 'field', rows: 3, placeholder: 'What is involved?' });
  description.value = project?.description ?? '';

  const target = el('input', { class: 'field', type: 'date', value: project?.target_date ?? '' });
  const cost = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', min: '0', step: 'any',
    value: project?.est_cost ?? '', placeholder: 'Rough cost (optional)',
  });

  let status = project?.status ?? 'idea';
  const statusRow = el('div', { class: 'chip-row' }, PROJECT_STATUSES.map(s =>
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(s.id === status), text: s.label,
      onclick: e => {
        status = s.id;
        for (const chip of e.currentTarget.parentElement.children) {
          chip.setAttribute('aria-pressed', String(chip === e.currentTarget));
        }
      },
    })));

  const save = async () => {
    const trimmed = title.value.trim();
    if (!trimmed) return errorToast('Give the project a name.');
    try {
      const fields = {
        title: trimmed,
        status,
        description: description.value.trim() || null,
        target_date: target.value || null,
        est_cost: cost.value === '' ? null : Number(cost.value),
      };
      const saved = editing
        ? await projectRepo.update(project.id, fields)
        : await projectRepo.create(fields);
      close();
      toast(editing ? 'Saved' : `Added ${trimmed}`);
      onDone ? onDone(saved) : refresh();
    } catch (err) {
      errorToast(err.message);
    }
  };

  sheet({
    title: editing ? 'Edit project' : 'New project',
    body: el('div', { class: 'stack-sm' }, [
      el('label', { class: 'field-label', text: 'What are you doing?' }),
      title,
      statusRow,
      description,
      el('label', { class: 'field-label', text: 'Target date' }),
      target,
      cost,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Cancel', onclick: () => close() }),
      el('button', { class: 'btn btn-primary btn-block', text: editing ? 'Save' : 'Add project', onclick: save }),
    ],
  });
}

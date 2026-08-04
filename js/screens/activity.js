// What the household has been doing, newest first.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import { feed, groupByDay, deltaLabel } from '../data/activity.js';

export default async function activity() {
  const entries = await feed(150);

  if (!entries.length) {
    return empty({
      glyph: ICONS.clock,
      title: 'Nothing has happened yet',
      body: 'Using something, restocking, moving a box, ticking off a maintenance '
          + 'job — it all turns up here, with who did it.',
    });
  }

  return el('div', { class: 'stack' },
    groupByDay(entries).map(group => el('div', {}, [
      el('div', { class: 'section-title', text: group.label }),
      el('div', { class: 'list' }, group.list.map(row)),
    ])));
}

function row(entry) {
  const delta = deltaLabel(entry.delta);
  const when = new Date(entry.at);

  return el('a', { class: 'row', href: entry.href }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title' }, [
        el('strong', { text: entry.who }),
        ' ',
        entry.text,
      ]),
      el('div', { class: 'row-sub', text:
        [when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), entry.detail]
          .filter(Boolean).join(' · ') }),
    ]),
    delta
      ? el('span', { class: `badge ${entry.delta > 0 ? 'badge-ok' : 'badge-warn'}`, text: delta })
      : entry.kind === 'maintenance'
        ? el('span', { class: 'badge badge-info', text: 'Done' })
        : null,
  ]);
}

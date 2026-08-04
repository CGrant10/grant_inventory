// Insights: what the house consumes and what it costs.
//
// Every figure here is derived from records the app already keeps — the event
// log and the receipts — so nothing on this screen needs maintaining. If it
// looks wrong, the underlying history is wrong, and that is worth knowing too.

import { el, icon, ICONS, empty } from '../ui/dom.js';
import * as idb from '../core/idb.js';
import { fmtQty } from '../data/items.js';
import { fmtMoney, fmtMoneyShort } from '../data/purchases.js';
import {
  usageStats, topUsed, memberActivity,
  spendByMonth, spendByVendor, spendTotal, monthStart, yearStart,
} from '../features/analytics.js';
import { today } from '../core/model.js';
import { device } from '../core/auth.js';

export default async function insights() {
  const [items, events, purchases, members] = await Promise.all([
    idb.all('items'),
    idb.all('item_events'),
    idb.all('purchases').catch(() => []),
    idb.all('members'),
  ]);

  const live = items.filter(i => !i.deleted_at);
  const usage = usageStats(events, live, { days: 90 });

  if (!events.length && !purchases.length) {
    return empty({
      glyph: ICONS.chart,
      title: 'Nothing to measure yet',
      body: 'Use a few things, record a receipt or two, and this screen fills in on '
          + 'its own — what runs out fastest, and where the money goes.',
    });
  }

  const monthly = spendByMonth(purchases, { months: 12 });
  const vendors = spendByVendor(purchases, { from: yearStart(), to: today() });
  const runningOut = usage.filter(u => Number.isFinite(u.daysLeft) && u.daysLeft <= 30).slice(0, 8);
  const used = topUsed(events, live, { days: 90, limit: 8 });
  const who = memberActivity(events, members, { days: 30 });

  return el('div', { class: 'stack' }, [
    el('div', { class: 'stat-grid' }, [
      tile('This month', fmtMoneyShort(spendTotal(purchases, { from: monthStart(), to: today() }))),
      tile('12 months', fmtMoneyShort(spendTotal(purchases, { from: yearStart(), to: today() }))),
      tile('Running out', String(runningOut.length), runningOut.length ? 'warn' : null),
      tile('Tracked', String(live.length)),
    ]),

    block('Running out soonest', runningOut.length
      ? el('div', { class: 'list' }, runningOut.map(runOutRow))
      : note('Nothing is on course to run out in the next month.')),

    block('Spending by month', monthly.some(m => m.total > 0)
      ? bars(monthly.map(m => ({
          label: m.label, value: m.total, text: m.total ? fmtMoneyShort(m.total) : '—',
        })))
      : note('No receipts with a price yet. Record one and this fills in.')),

    block('Where the money went', vendors.length
      ? bars(vendors.map(v => ({ label: v.vendor, value: v.total, text: fmtMoney(v.total) })))
      : note('Add a shop name to a receipt to see this broken down.')),

    block('Used most, last 90 days', used.length
      ? bars(used.map(u => ({
          label: u.item.name,
          value: u.used,
          text: `${fmtQty(u.used)} ${u.item.unit || ''}`.trim(),
          href: `#/item/${u.item.id}`,
        })))
      : note('Nothing has been used up in the last 90 days.')),

    block('Who did what, last 30 days', who.length
      ? bars(nameApart(who).map(m => ({ label: m.label, value: m.count, text: `${m.count}` })))
      : note('No activity recorded in the last 30 days.')),

    el('p', { class: 'help', text:
      'Usage counts only things marked as used — corrections and recounts are left '
      + 'out, so one bad count cannot look like a busy week.' }),
  ]);
}

/**
 * Two phones that never set a name are both called "Me", and two identical rows
 * read as a bug rather than as two devices. Merging them would be worse — they
 * are different people — so they get told apart instead: this phone by name, the
 * others by the head of their id, which at least stays the same next week.
 */
function nameApart(rows) {
  const mine = device().id;
  const seen = new Map();
  for (const r of rows) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);

  return rows.map(r => ({
    ...r,
    label: r.id === mine ? `${r.name} (this phone)`
      : seen.get(r.name) > 1 ? `${r.name} · ${String(r.id ?? '').slice(0, 4)}`
      : r.name,
  }));
}

function tile(label, value, tone) {
  return el('div', { class: 'stat' }, [
    el('div', { class: `stat-value stat-money ${tone ? `is-${tone}` : ''}`, text: value }),
    el('div', { class: 'stat-label', text: label }),
  ]);
}

function block(title, body) {
  return el('div', {}, [el('div', { class: 'section-title', text: title }), body]);
}

function note(text) {
  return el('p', { class: 'help pad', text });
}

/**
 * A bar chart made of rows, not columns. Twelve vertical bars on a phone gives
 * every label four characters and every value none; horizontally each row has
 * the whole width, and the eye still compares lengths.
 */
function bars(rows) {
  const max = Math.max(...rows.map(r => Number(r.value) || 0), 1);

  return el('div', { class: 'bars' }, rows.map(row => {
    const pct = Math.max(2, Math.round((Number(row.value) || 0) / max * 100));
    const inner = [
      el('span', { class: 'bar-label', text: row.label }),
      el('span', { class: 'bar-track' }, [
        el('span', { class: 'bar-fill', style: `width:${pct}%` }),
      ]),
      el('span', { class: 'bar-value', text: row.text }),
    ];
    return row.href
      ? el('a', { class: 'bar-row', href: row.href }, inner)
      : el('div', { class: 'bar-row' }, inner);
  }));
}

function runOutRow({ item, daysLeft, runsOutOn, used }) {
  const label = daysLeft <= 0 ? 'Out now'
    : daysLeft === 1 ? 'About a day left'
    : `About ${daysLeft} days left`;

  return el('a', { class: 'row', href: `#/item/${item.id}` }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: item.name }),
      el('div', { class: 'row-sub', text:
        `${label} · ${fmtQty(item.quantity)} ${item.unit || ''} left · used ${fmtQty(used)} in 90 days`.replace(/\s+/g, ' ') }),
    ]),
    el('span', { class: `badge ${daysLeft <= 7 ? 'badge-danger' : 'badge-warn'}`,
                 text: daysLeft <= 0 ? 'Out' : runsOutOn.slice(5) }),
    el('span', { class: 'row-chevron' }, [icon(ICONS.chevron, 20)]),
  ]);
}

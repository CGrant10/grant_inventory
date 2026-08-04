// The single source of truth for what tables exist locally and how they're indexed.
//
// Adding a feature = adding an entry here + a repository in js/data/. The IndexedDB
// upgrade path and the sync engine both read this list, so nothing else needs to know.

export const TABLES = {
  members:          { indexes: [] },
  categories:       { indexes: ['sort_order'] },
  locations:        { indexes: ['parent_id', 'qr_slug'] },
  products:         { indexes: ['barcode', 'category_id'] },
  items:            { indexes: ['location_id', 'product_id', 'category_id', 'expires_on'] },
  item_events:      { indexes: ['item_id', 'created_at'] },
  shopping_items:   { indexes: ['status', 'product_id'] },
  measurements:     { indexes: ['location_id', 'subject_kind'] },
  measurement_dims: { indexes: ['measurement_id'] },
  projects:         { indexes: ['status'] },
  project_lines:    { indexes: ['project_id'] },
  attachments:      { indexes: ['entity_id', 'entity_type'] },
  maintenance_tasks:{ indexes: ['next_due_on', 'location_id', 'item_id'] },
  maintenance_log:  { indexes: ['task_id', 'done_on'] },
  purchases:        { indexes: ['item_id', 'purchased_on', 'warranty_until'] },
};

export const TABLE_NAMES = Object.keys(TABLES);

// Append-only tables never update in place, so sync pages them by created_at
// instead of updated_at and never needs to reconcile edits.
export const APPEND_ONLY = new Set(['item_events', 'maintenance_log']);

export const LOCATION_KINDS = [
  { id: 'room',     label: 'Room' },
  { id: 'area',     label: 'Area' },
  { id: 'cabinet',  label: 'Cabinet' },
  { id: 'shelf',    label: 'Shelf' },
  { id: 'drawer',   label: 'Drawer' },
  { id: 'fridge',   label: 'Refrigerator' },
  { id: 'freezer',  label: 'Freezer' },
  { id: 'closet',   label: 'Closet' },
  { id: 'bin',      label: 'Bin' },
  { id: 'tote',     label: 'Tote' },
  { id: 'other',    label: 'Other' },
];

export const EVENT_TYPES = ['add', 'consume', 'restock', 'adjust', 'move', 'discard', 'expire'];

export const PROJECT_STATUSES = [
  { id: 'idea',    label: 'Idea' },
  { id: 'planned', label: 'Planned' },
  { id: 'active',  label: 'Active' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done',    label: 'Done' },
];

export const UNITS = [
  'ea', 'pkg', 'box', 'can', 'bottle', 'bag', 'roll',
  'lb', 'oz', 'g', 'kg', 'gal', 'qt', 'L', 'mL', 'ft', 'in',
];

export const MEASURE_UNITS = ['in', 'ft', 'cm', 'mm', 'm'];

export const SUBJECT_KINDS = [
  { id: 'room',      label: 'Room' },
  { id: 'window',    label: 'Window' },
  { id: 'door',      label: 'Door' },
  { id: 'cabinet',   label: 'Cabinet' },
  { id: 'appliance', label: 'Appliance' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'other',     label: 'Other' },
];

// The dimensions people actually reach for, per kind of thing. Offered as a
// starting set so a measurement is three numbers and a name, not a form.
export const DIM_PRESETS = {
  room:      ['Width', 'Length', 'Ceiling height'],
  window:    ['Width', 'Height', 'Sill depth'],
  door:      ['Width', 'Height', 'Jamb depth'],
  cabinet:   ['Width', 'Height', 'Depth'],
  appliance: ['Width', 'Height', 'Depth'],
  furniture: ['Width', 'Height', 'Depth'],
  other:     ['Width', 'Height'],
};

export const LINE_KINDS = [
  { id: 'material', label: 'Material' },
  { id: 'tool',     label: 'Tool' },
  { id: 'task',     label: 'Task' },
];

// Every-six-months means the same date six months on, not 182 days later. Days
// drift, and by the third change the reminder is in the wrong week.
export const INTERVAL_UNITS = [
  { id: 'day',   label: 'days' },
  { id: 'week',  label: 'weeks' },
  { id: 'month', label: 'months' },
  { id: 'year',  label: 'years' },
];

// Warranties are quoted in months on the box — "1 year parts and labour",
// "90 days". Stored as an end date, because that is the only thing anyone ever
// needs to answer: is this still covered?
export const WARRANTY_PRESETS = [
  { label: 'No warranty', months: 0 },
  { label: '90 days',     months: 3 },
  { label: '1 year',      months: 12 },
  { label: '2 years',     months: 24 },
  { label: '3 years',     months: 36 },
  { label: '5 years',     months: 60 },
  { label: '10 years',    months: 120 },
];

export const MAINTENANCE_PRESETS = [
  { label: 'Monthly',      value: 1,  unit: 'month' },
  { label: 'Every 3 months', value: 3, unit: 'month' },
  { label: 'Every 6 months', value: 6, unit: 'month' },
  { label: 'Yearly',       value: 1,  unit: 'year' },
];

/**
 * Add an interval to a date, in local time, clamping to the end of a short
 * month. 31 January plus one month is 28 February, not 3 March.
 */
export function addInterval(isoDate, value, unit) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  const n = Number(value) || 0;

  if (unit === 'day')  return toIso(new Date(y, m - 1, d + n));
  if (unit === 'week') return toIso(new Date(y, m - 1, d + n * 7));

  const months = unit === 'year' ? n * 12 : n;
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return toIso(target);
}

export function toIso(date) {
  // Local date, not UTC: a job due "today" must not flip a day either side of
  // midnight depending on the timezone.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function today() {
  return toIso(new Date());
}

export function daysBetween(fromIso, toIsoDate) {
  const [y1, m1, d1] = String(fromIso).slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = String(toIsoDate).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Older iOS Safari: build a v4 from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10).join('')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

/**
 * A URL-safe slug with random entropy appended.
 *
 * locations.qr_slug is UNIQUE, and upserts merge on the primary key, not on the
 * slug — so two phones that each create a "Pantry Shelf 2" while offline would
 * generate the same slug and one of them could never push. The suffix makes a
 * collision effectively impossible. Nobody types these; they live inside QR
 * codes, so readability only has to survive a glance at a printed label.
 *
 * Six characters from a 32-symbol alphabet is ~1e9 combinations. Four was not
 * enough: 2000 draws collided four times in testing, and a collision means a
 * write that can never reach the server.
 */
export function slug(text, entropy = 6) {
  const base = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '') || 'place';

  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';   // no l/o/0/1 — misread on paper
  const bytes = crypto.getRandomValues(new Uint8Array(entropy));
  const tail = [...bytes].map(b => alphabet[b % alphabet.length]).join('');

  return `${base}-${tail}`;
}

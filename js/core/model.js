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
};

export const TABLE_NAMES = Object.keys(TABLES);

// Append-only tables never update in place, so sync pages them by created_at
// instead of updated_at and never needs to reconcile edits.
export const APPEND_ONLY = new Set(['item_events']);

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

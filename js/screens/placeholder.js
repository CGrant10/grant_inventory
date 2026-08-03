// Screens whose features land in later phases. They exist now so navigation,
// routing, and the tab bar are complete and testable end to end.

import { el, icon, ICONS } from '../ui/dom.js';

export function placeholder({ glyph, title, body, phase }) {
  return () => el('div', { class: 'empty' }, [
    icon(glyph, 44),
    el('div', { class: 'empty-title', text: title }),
    el('div', { class: 'empty-body', text: body }),
    el('div', { class: 'badge badge-info', text: `Phase ${phase}` }),
  ]);
}

export const inventory = placeholder({
  glyph: ICONS.box, phase: 3,
  title: 'Inventory',
  body: 'Every item, grouped by category or place, with quantities you can change in one tap.',
});

export const locations = placeholder({
  glyph: ICONS.pin, phase: 2,
  title: 'Places',
  body: 'Rooms, shelves, bins and totes as a tree — each with a printable QR code that opens straight to its contents.',
});

export const scan = placeholder({
  glyph: ICONS.box, phase: 4,
  title: 'Scan',
  body: 'Point the camera at a barcode to use, restock, look up, or move an item. Location QR codes open the bin.',
});

export const shopping = placeholder({
  glyph: ICONS.cart, phase: 5,
  title: 'Shopping list',
  body: 'Built automatically from anything below its minimum. Tick items off and they go back into inventory.',
});

export const measurements = placeholder({
  glyph: ICONS.ruler, phase: 6,
  title: 'Measurements',
  body: 'Rooms, windows, cabinets and appliances — dimensions and photos, findable when a project needs them.',
});

export const projects = placeholder({
  glyph: ICONS.hammer, phase: 7,
  title: 'Projects',
  body: 'Plans, materials, costs and status for everything you intend to do to the house.',
});

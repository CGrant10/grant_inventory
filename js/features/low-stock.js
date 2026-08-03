// Keeps the shopping list in step with what is actually on the shelves.
//
// Reconciling rather than reacting: work out what the list *should* contain and
// close the gap. That way it is self-correcting — a change made on another phone,
// an event that arrived late, or a line someone deleted all end up in the right
// place on the next pass, with no need to catch every edit as it happens.

import * as idb from '../core/idb.js';
import { isLow } from '../data/items.js';
import { shoppingRepo, STATUS } from '../data/shopping.js';

const MIN_GAP_MS = 4000;
let lastRun = 0;
let running = null;

/** How many to buy: enough to get back to the minimum, but never zero. */
function suggestedQuantity(item) {
  const shortfall = Number(item.min_quantity ?? 0) - Number(item.quantity ?? 0);
  return Math.max(1, Math.ceil(shortfall));
}

/**
 * @param {boolean} force skip the throttle
 * @returns {Promise<{added:number, updated:number, removed:number}>}
 */
export async function reconcile(force = false) {
  if (running) return running;
  if (!force && Date.now() - lastRun < MIN_GAP_MS) {
    return { added: 0, updated: 0, removed: 0, skipped: true };
  }

  running = (async () => {
    const [items, lines] = await Promise.all([
      idb.all('items'),
      idb.all('shopping_items'),
    ]);

    const autoByItem = new Map();
    for (const line of lines) {
      if (line.auto_generated && line.item_id) autoByItem.set(line.item_id, line);
    }

    let added = 0, updated = 0, removed = 0;

    for (const item of items) {
      const line = autoByItem.get(item.id);

      if (isLow(item)) {
        const want = suggestedQuantity(item);
        if (!line) {
          await shoppingRepo.add({
            name: item.name,
            quantity: want,
            unit: item.unit || 'ea',
            item_id: item.id,
            product_id: item.product_id ?? null,
            auto_generated: true,
          });
          added++;
        } else if (line.status === STATUS.PURCHASED) {
          // Bought, but still low — it wants buying again, so start it over.
          await shoppingRepo.update(line.id, {
            status: STATUS.NEEDED, quantity: want, purchased_at: null, purchased_by: null,
          });
          updated++;
        } else if (Number(line.quantity) !== want && line.status === STATUS.NEEDED) {
          // Only nudge the amount while it is still just "needed". Once it is in
          // the cart the number on the list is the shopper's decision, not ours.
          await shoppingRepo.update(line.id, { quantity: want });
          updated++;
        }
        continue;
      }

      // Not low any more. Drop the suggestion, unless someone has already acted
      // on it — a line in the cart or ticked off is a record of a real trip.
      if (line && line.status === STATUS.NEEDED) {
        await shoppingRepo.softDelete(line.id);
        removed++;
      }
    }

    // A line whose item was deleted has nothing left to track.
    const liveIds = new Set(items.map(i => i.id));
    for (const line of lines) {
      if (line.auto_generated && line.item_id && !liveIds.has(line.item_id)
          && line.status === STATUS.NEEDED) {
        await shoppingRepo.softDelete(line.id);
        removed++;
      }
    }

    lastRun = Date.now();
    return { added, updated, removed };
  })();

  try {
    return await running;
  } finally {
    running = null;
  }
}

/** How many things are waiting to be bought. */
export async function neededCount() {
  const rows = await idb.all('shopping_items');
  return rows.filter(r => r.status === STATUS.NEEDED).length;
}

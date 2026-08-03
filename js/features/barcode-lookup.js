// Barcode -> product name.
//
// Open Food Facts is free, needs no key, and covers groceries well. Everything
// it returns is cached into our own products table, so the second scan of a
// barcode is instant and works offline — and a code it has never heard of is
// remembered once you name it yourself.

import { productRepo } from '../data/products.js';

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = 'product_name,brands,quantity,image_front_small_url,categories_tags';
const TIMEOUT_MS = 6000;

/**
 * @returns {Promise<{source:'local'|'off'|'unknown', product?:object, suggestion?:object}>}
 *   'local'   — already in our catalog, nothing to ask the user
 *   'off'     — found online; suggestion is a draft for the create form
 *   'unknown' — nobody knows it; the user names it
 */
export async function lookup(barcode) {
  const known = await productRepo.byBarcode(barcode);
  if (known) return { source: 'local', product: known };

  const remote = await fromOpenFoodFacts(barcode);
  if (remote) return { source: 'off', suggestion: remote };

  return { source: 'unknown' };
}

async function fromOpenFoodFacts(barcode) {
  if (!navigator.onLine) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;

    const body = await res.json();
    // status 0 means "no such product", which is a normal answer, not an error.
    if (!body?.product || body.status === 0) return null;

    const p = body.product;
    const name = (p.product_name || '').trim();
    if (!name) return null;

    return {
      barcode: String(barcode),
      name,
      brand: (p.brands || '').split(',')[0]?.trim() || null,
      image_url: p.image_front_small_url || null,
      // "500 g" and the like — useful as the unit hint on the create form.
      size: (p.quantity || '').trim() || null,
      source: 'off',
    };
  } catch (err) {
    // Offline, blocked, or slow. Not worth surfacing: the user can just type it.
    console.info('[barcode] Open Food Facts lookup failed', err.name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Save a looked-up or hand-typed product so the next scan is instant. */
export async function remember(draft) {
  const existing = await productRepo.byBarcode(draft.barcode);
  if (existing) return existing;
  return productRepo.create(draft);
}

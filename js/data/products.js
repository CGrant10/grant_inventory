// The product catalog: what a barcode means.
//
// Deliberately separate from items. A product is "Bush's black beans, 15oz";
// an item is "four of them, on pantry shelf 2". Scanning the same code in the
// kitchen and the basement finds one product and two items.

import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';

const base = makeRepo('products');

export const productRepo = {
  ...base,

  async byBarcode(barcode) {
    if (!barcode) return null;
    const [hit] = await idb.where('products', 'barcode', String(barcode));
    return hit ?? null;
  },

  async create({ barcode = null, name, brand = null, default_unit = 'ea',
                 category_id = null, image_url = null, source = 'manual', attributes = {} }) {
    return base.create({
      barcode: barcode ? String(barcode) : null,
      name: String(name).trim(),
      brand,
      default_unit,
      category_id,
      image_url,
      source,
      attributes,
    });
  },

  /** Every stock lot of this product, wherever it lives. */
  async items(productId) {
    return idb.where('items', 'product_id', productId);
  },
};

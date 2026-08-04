// Attachments: one photo table for everything.
//
// `entity_type` + `entity_id` instead of a column per parent, so adding photos
// to a new kind of thing is a string, not a migration.

import { makeRepo } from './base.js';
import * as idb from '../core/idb.js';
import { uuid } from '../core/model.js';
import { shrink, storagePath, drain } from '../features/photos.js';

const base = makeRepo('attachments');

export const ENTITY_TYPES = ['item', 'location', 'measurement', 'project', 'purchase', 'product'];

export const attachmentRepo = {
  ...base,

  /** Oldest first: the first photo of a thing is usually the one that shows it. */
  async forEntity(entityType, entityId) {
    const rows = await idb.where('attachments', 'entity_id', entityId);
    return rows
      .filter(a => a.entity_type === entityType && !a.deleted_at)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  },

  /** How many photos each of a set of entities has, for list badges. */
  async countsFor(entityType) {
    const rows = await idb.all('attachments');
    const counts = new Map();
    for (const a of rows) {
      if (a.entity_type !== entityType) continue;
      counts.set(a.entity_id, (counts.get(a.entity_id) ?? 0) + 1);
    }
    return counts;
  },

  /**
   * Take a file from an <input>, shrink it, keep it on this phone, and record it.
   *
   * The blob is written before the row: if the app dies between the two, the
   * worst case is an orphan blob taking up space, not a row pointing at a photo
   * that does not exist. The row is what other phones see, so it must never be
   * the thing that arrives first.
   */
  async addPhoto(entityType, entityId, file) {
    if (!file?.type?.startsWith('image/')) throw new Error('That file is not an image.');

    const id = uuid();
    const path = storagePath(entityType, entityId, id);
    const { blob, width, height } = await shrink(file);

    await idb.blobPut(id, blob, { path, uploaded: false });

    const row = await base.create({
      id,
      entity_type: entityType,
      entity_id: entityId,
      storage_path: path,
      kind: 'photo',
      width,
      height,
    });

    drain();
    return row;
  },

  /**
   * Soft delete, matching every other table.
   *
   * The file itself stays in the bucket — anon has no delete policy on storage,
   * by design, so a passer-by cannot wipe the household's photos. It does mean a
   * deleted photo still counts against the 1 GB; clearing those out is a job for
   * the Supabase dashboard, not for a phone.
   */
  async remove(id) {
    return base.softDelete(id);
  },
};

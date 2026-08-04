// Photos: capture, shrink, queue, upload, cache.
//
// The rule that shapes this file is the same one that shapes the sync engine:
// nothing the user does may wait for the network. Taking a photo writes a blob
// to IndexedDB and an `attachments` row to the outbox, and returns. The upload
// happens later, or tomorrow, or never — the picture is on the phone either way
// and the row will find its way up when the outbox drains.
//
// Storage is the one resource here that is genuinely scarce. The free tier gives
// 1 GB of files and 5 GB of egress a month, so:
//   - nothing is ever uploaded at full resolution (see shrink)
//   - every photo downloaded is kept in _blobs, so a phone fetches each one once
// A 12-megapixel phone photo is ~4 MB; the same picture at 1600px is ~250 KB.
// That is the difference between 250 photos and 4,000.

import * as idb from '../core/idb.js';
import * as sb from '../core/supabase.js';
import { isConfigured } from '../core/config.js';
import { on, emit, EVENTS } from '../core/bus.js';
import { isSyncing } from '../core/auth.js';

export const MAX_EDGE = 1600;
export const QUALITY = 0.82;

/**
 * Downscale to fit inside a square of `maxEdge` and re-encode as JPEG.
 *
 * Smaller images are left alone rather than being re-encoded: running a photo
 * through JPEG twice loses quality for no saving.
 *
 * `imageOrientation: 'from-image'` matters more than it looks — without it every
 * photo taken in portrait on an iPhone arrives sideways, because the rotation
 * lives in EXIF and canvas ignores EXIF.
 */
export async function shrink(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('This phone could not read that image.');

  return { blob, width, height };
}

/**
 * Where a photo lives in the bucket.
 *
 * Foldered by entity so the bucket stays browsable in the Supabase dashboard,
 * and named by the attachment's own id so an upload retried after a half-failure
 * overwrites itself instead of leaving a duplicate behind.
 */
export function storagePath(entityType, entityId, attachmentId) {
  return `${entityType}/${entityId}/${attachmentId}.jpg`;
}

/* ---- The upload queue ---- */

let draining = false;

/**
 * Push every photo that has not reached the bucket yet.
 *
 * Failures are left queued rather than counted out. Unlike a bad row, a photo
 * that will not upload is almost always a transient — offline, a flaky signal,
 * a bucket that has not been created yet — and the blob is the only copy the
 * household has until it lands.
 */
export async function drain() {
  if (draining || !isConfigured() || !isSyncing() || !navigator.onLine) return 0;

  draining = true;
  let sent = 0;
  try {
    const pending = (await idb.blobAll()).filter(b => !b.uploaded && b.path);
    for (const record of pending) {
      try {
        await sb.uploadPhoto(record.path, record.blob);
        await idb.blobPut(record.id, record.blob, { path: record.path, uploaded: true });
        sent++;
      } catch (err) {
        // A missing bucket is worth saying out loud once: it is the one failure
        // here that a person has to go and fix, and it never resolves on its own.
        if (err.status === 400 || err.status === 404) {
          console.warn('[photos] the "photos" bucket is missing — run supabase/open-access.sql', err);
        } else {
          console.warn('[photos] upload deferred', err);
        }
        break;      // one failure means the network is unhappy; try again next cycle
      }
    }
  } finally {
    draining = false;
  }

  if (sent) emit(EVENTS.DATA_CHANGED, { table: 'attachments', source: 'local' });
  return sent;
}

/** How many photos are still only on this phone. */
export async function pendingCount() {
  return (await idb.blobAll()).filter(b => !b.uploaded && b.path).length;
}

/** Total bytes held locally — the cache plus the queue. */
export async function localBytes() {
  return (await idb.blobAll()).reduce((sum, b) => sum + (b.blob?.size ?? 0), 0);
}

/* ---- Reading ---- */

/**
 * A displayable URL for one attachment.
 *
 * Local blob first — it is instant, works offline, and costs no egress. Only a
 * photo this phone has never seen is fetched, and it is cached on the way past.
 * Returns null rather than throwing when a photo cannot be had at all, because
 * a broken thumbnail is not worth taking a screen down for.
 */
export async function photoUrl(attachment) {
  const cached = await idb.blobGet(attachment.id);
  if (cached?.blob) return URL.createObjectURL(cached.blob);

  if (!attachment.storage_path || !navigator.onLine) return null;
  try {
    const blob = await sb.downloadPhoto(attachment.storage_path);
    await idb.blobPut(attachment.id, blob, { path: attachment.storage_path, uploaded: true });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn('[photos] could not fetch', attachment.storage_path, err);
    return null;
  }
}

/* ---- Lifecycle ---- */

export function start() {
  // Ride along with the sync engine rather than keeping a timer of its own: if
  // the network is good enough to have just synced, it is good enough to upload.
  on(EVENTS.SYNC_STATE, state => { if (state === 'synced') drain(); });
  window.addEventListener('online', () => drain());
  drain();
}

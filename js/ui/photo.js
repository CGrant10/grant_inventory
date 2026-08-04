// The photo strip: what a thing looks like, wherever it appears.
//
// One component for items, places, measurements, projects and receipts, because
// the interaction is identical everywhere — a row of thumbnails, an add tile at
// the end, and a tap to see one full size.

import { el, icon, ICONS } from './dom.js';
import { sheet, close, confirmSheet } from './sheet.js';
import { toast, errorToast } from './toast.js';
import { attachmentRepo } from '../data/attachments.js';
import { photoUrl } from '../features/photos.js';
import * as idb from '../core/idb.js';

/**
 * A strip of photos for one entity, ready to drop into a screen.
 *
 * Returns synchronously so screens can lay it out in one pass; the thumbnails
 * arrive a tick later. A photo strip is never the reason a screen is slow.
 */
export function photoStrip(entityType, entityId, { title = 'Photos', onChange } = {}) {
  const strip = el('div', { class: 'photo-strip' });

  const input = el('input', {
    type: 'file', accept: 'image/*', multiple: true, class: 'sr-only',
    onchange: async () => {
      const files = [...input.files];
      input.value = '';                    // so picking the same file twice still fires
      if (!files.length) return;

      // Shrinking a 12MP photo takes a moment on an old phone, and silence there
      // reads as "the button did nothing". The toast is dismissed by hand, not by
      // its timer, so it lasts exactly as long as the work does.
      const working = toast(files.length > 1 ? `Saving ${files.length} photos…` : 'Saving photo…',
                            { ms: 60_000 });
      try {
        for (const file of files) await attachmentRepo.addPhoto(entityType, entityId, file);
        working();
        toast(files.length > 1 ? `${files.length} photos added` : 'Photo added');
        onChange?.();
      } catch (err) {
        working();
        errorToast(err.message);
      }
    },
  });

  const addTile = el('button', {
    class: 'photo-add', type: 'button', 'aria-label': 'Add a photo',
    onclick: () => input.click(),
  }, [icon(ICONS.camera, 24), el('span', { text: 'Add' })]);

  const container = el('div', {}, [
    el('div', { class: 'section-title', text: title }),
    strip,
    input,
  ]);

  fill(strip, addTile, entityType, entityId, onChange);
  return container;
}

async function fill(strip, addTile, entityType, entityId, onChange) {
  let photos = [];
  try {
    photos = await attachmentRepo.forEntity(entityType, entityId);
  } catch (err) {
    console.warn('[photo] could not list attachments', err);
  }

  strip.replaceChildren(
    ...photos.map(p => thumb(p, photos, onChange)),
    addTile,
  );
}

function thumb(attachment, all, onChange) {
  // Deliberately not loading="lazy". These are blob: URLs whose bytes are
  // already in memory, so deferring saves no network — and an image that never
  // loads never fires `load`, which is exactly when the object URL is revoked.
  // Lazy here buys nothing and leaks every thumbnail that stays off screen.
  const img = el('img', { class: 'photo-thumb-img', alt: '' });
  const button = el('button', {
    class: 'photo-thumb', type: 'button', 'aria-label': 'View photo',
    onclick: () => viewer(attachment, all, onChange),
  }, [img]);

  paint(img, attachment, button);
  return button;
}

/**
 * Point an <img> at a photo, and revoke the object URL once it has been decoded.
 *
 * Revoking after load is safe — the image is already rendered — and it is the
 * difference between a screen that leaks a few megabytes per visit and one that
 * does not.
 */
async function paint(img, attachment, host) {
  const url = await photoUrl(attachment);
  if (!url) {
    host?.classList.add('is-missing');
    host?.append(el('span', { class: 'photo-missing', text: 'Not here yet' }));
    return;
  }
  img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
  img.src = url;
}

async function viewer(attachment, all, onChange) {
  const img = el('img', { class: 'photo-full', alt: '' });
  const record = await idb.blobGet(attachment.id);
  const pending = record && !record.uploaded;

  paint(img, attachment);

  const index = all.findIndex(a => a.id === attachment.id);

  sheet({
    title: all.length > 1 ? `Photo ${index + 1} of ${all.length}` : 'Photo',
    body: el('div', { class: 'stack-sm' }, [
      img,
      pending ? el('p', { class: 'help', text:
        'On this phone only so far — it goes up the next time the app syncs.' }) : null,
    ]),
    actions: [
      el('button', { class: 'btn btn-block', text: 'Close', onclick: () => close() }),
      el('button', {
        class: 'btn btn-danger btn-block', text: 'Delete photo',
        onclick: async () => {
          const ok = await confirmSheet({
            title: 'Delete this photo?',
            message: 'It disappears from every phone.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          await attachmentRepo.remove(attachment.id);
          close();
          toast('Photo deleted');
          onChange?.();
        },
      }),
    ],
  });
}

// Pull down to sync.
//
// The gesture a thumb already expects. The app has had a sync engine since the
// first release, but the only ways to ask it for a sync were the Settings page
// and a 10px dot in the top bar — neither of which is what anyone reaches for
// when a list looks out of date.

import { el, icon } from './dom.js';
import { isOpen as isSheetOpen } from './sheet.js';

const TRIGGER = 64;      // how far to pull before letting go does anything
const MAX = 96;          // where the rubber band stops giving
const RESISTANCE = 0.5;  // finger travel to indicator travel

const SPINNER = '<path d="M12 4a8 8 0 108 8"/>';
const TICK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';

/**
 * @param {HTMLElement} host   the app shell, for the indicator to sit against
 * @param {() => Promise} onSync  what a completed pull actually does
 */
export function mountPullToSync(host, onSync) {
  const badge = el('div', { class: 'pull-badge', 'aria-hidden': 'true' },
    [icon(SPINNER, 22)]);
  host.prepend(badge);

  let startY = 0;
  let startX = 0;
  let pulling = false;      // a real vertical pull, decided after a few pixels
  let tracking = false;     // finger down at the top of the page
  let distance = 0;
  let running = false;

  const paint = () => {
    const travel = Math.min(distance * RESISTANCE, MAX);
    badge.style.transform = `translate(-50%, ${travel}px)`;
    badge.style.opacity = String(Math.min(1, travel / (TRIGGER * RESISTANCE)));
    badge.classList.toggle('is-ready', travel >= TRIGGER * RESISTANCE);
    // The icon turns as you pull, so the gesture has a sense of winding up.
    badge.firstChild.style.transform = `rotate(${travel * 3}deg)`;
  };

  const reset = () => {
    badge.classList.add('is-settling');
    badge.style.transform = '';
    badge.style.opacity = '';
    badge.classList.remove('is-ready', 'is-running', 'is-done');
    badge.firstChild.style.transform = '';
    setTimeout(() => badge.classList.remove('is-settling'), 280);
  };

  host.addEventListener('touchstart', e => {
    if (running || isSheetOpen() || e.touches.length !== 1) return;
    // Only from a genuine top-of-page. Starting mid-list would fight the scroll.
    if (window.scrollY > 0) return;
    tracking = true;
    pulling = false;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    distance = 0;
  }, { passive: true });

  host.addEventListener('touchmove', e => {
    if (!tracking) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;

    if (!pulling) {
      // Wait for the finger to commit before claiming the gesture, or a sideways
      // swipe across the photo strip would be stolen by the refresher.
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { tracking = false; return; }
      pulling = true;
      badge.classList.add('is-active');
    }

    if (dy <= 0) { distance = 0; paint(); return; }
    distance = dy;
    paint();
    // Claim the gesture so the browser does not also try to overscroll.
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  const finish = async () => {
    if (!tracking) return;
    tracking = false;
    if (!pulling) return;
    pulling = false;
    badge.classList.remove('is-active');

    if (distance * RESISTANCE < TRIGGER * RESISTANCE) return reset();

    running = true;
    badge.classList.add('is-running');
    badge.style.transform = `translate(-50%, ${TRIGGER * RESISTANCE}px)`;
    badge.style.opacity = '1';
    badge.firstChild.style.transform = '';

    try {
      await onSync();
      badge.classList.remove('is-running');
      badge.classList.add('is-done');
      badge.firstChild.innerHTML = TICK;
    } catch (err) {
      console.warn('[pull] sync failed', err);
    }

    // Let the tick be seen before it goes away — a refresh that vanishes the
    // instant it finishes reads as though nothing happened.
    setTimeout(() => {
      reset();
      badge.firstChild.innerHTML = SPINNER;
      running = false;
    }, 550);
  };

  host.addEventListener('touchend', finish, { passive: true });
  host.addEventListener('touchcancel', () => {
    tracking = false;
    if (pulling) { pulling = false; badge.classList.remove('is-active'); reset(); }
  }, { passive: true });
}

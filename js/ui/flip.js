// FLIP: make a list change legible.
//
// Ticking something off the shopping list moves it from one section to another.
// Repainting the screen puts it in its new place instantly, and a row that
// teleports is a row you have to go and find again to be sure of what happened.
// Measure where things were, repaint, then animate each one from where it was to
// where it now is — the eye follows the movement and the question never comes up.
//
// Rows are matched by `data-flip-key`, not by node identity, so this works even
// when the repaint throws away every element and builds new ones.

const DURATION = 280;
const EASE = 'cubic-bezier(.2,.8,.25,1)';

function reduced() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {HTMLElement} root    the subtree that is about to be rebuilt
 * @param {() => void} mutate   rebuilds it, synchronously
 */
export function flip(root, mutate) {
  if (reduced() || !root.isConnected) return mutate();

  const before = new Map();
  for (const node of root.querySelectorAll('[data-flip-key]')) {
    before.set(node.dataset.flipKey, node.getBoundingClientRect());
  }

  mutate();

  for (const node of root.querySelectorAll('[data-flip-key]')) {
    const old = before.get(node.dataset.flipKey);
    const now = node.getBoundingClientRect();

    // Something that was not here before has arrived, rather than moved.
    if (!old) {
      node.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: DURATION, easing: EASE },
      );
      continue;
    }

    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (!dx && !dy) continue;

    node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: DURATION, easing: EASE },
    );
  }
}

/**
 * Fade a row out and wait, so a deletion is seen leaving rather than simply
 * never having been there. Resolves once the row is ready to be discarded.
 */
export function flipOut(node) {
  if (reduced() || !node?.isConnected) return Promise.resolve();
  return node.animate(
    [{ opacity: 1 }, { opacity: 0, transform: 'translateX(-12px)' }],
    { duration: 180, easing: EASE, fill: 'forwards' },
  ).finished.catch(() => {});
}

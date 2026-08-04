// Element helpers. Screens build DOM with these instead of innerHTML, so user
// data (item names, notes) can never be parsed as markup.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;          // only for trusted icon markup
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Inline SVG from a path string. Icon markup is authored here, never user input. */
export function icon(paths, size = 24) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.innerHTML = paths;
  return svg;
}

export const ICONS = {
  chevron: '<path d="M9 5l7 7-7 7"/>',
  plus:    '<path d="M12 5v14M5 12h14"/>',
  minus:   '<path d="M5 12h14"/>',
  box:     '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 11h18M8 7V3h8v4"/>',
  pin:     '<path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  cart:    '<path d="M4 5h2l2.5 11h9L20 8H7"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  ruler:   '<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  hammer:  '<path d="M14 6l4 4M3 21l9-9"/><path d="M12.5 3.5l8 8-2.5 2.5-8-8z"/>',
  warn:    '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17v.5"/>',
  clock:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search:  '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  chart:   '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 17v-5M13 17V8M18 17v-7"/>',
};

/**
 * Remove a node once its exit animation finishes, with a timer as backstop.
 *
 * animationend is not guaranteed: a background tab, a browser that skips the
 * animation, or a display:none ancestor all swallow it, and a modal that never
 * tears down leaves the app unusable. The timer makes removal unconditional.
 */
export function removeAfterExit(node, fallbackMs = 400) {
  let done = false;
  const remove = () => {
    if (done) return;
    done = true;
    node.remove();
  };
  node.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, fallbackMs);
}

export function fragment(children) {
  const frag = document.createDocumentFragment();
  for (const c of [].concat(children)) if (c) frag.append(c);
  return frag;
}

export function empty({ glyph = ICONS.box, title, body, action } = {}) {
  return el('div', { class: 'empty' }, [
    icon(glyph, 44),
    el('div', { class: 'empty-title', text: title }),
    body && el('div', { class: 'empty-body', text: body }),
    action,
  ]);
}

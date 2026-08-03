// Tiny pub/sub. Repositories announce data changes; screens re-render.
// Keeps screens from polling and keeps repos from knowing about the UI.

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, detail) {
  listeners.get(event)?.forEach(fn => {
    try { fn(detail); }
    catch (err) { console.error(`[bus] ${event} listener failed`, err); }
  });
  listeners.get('*')?.forEach(fn => {
    try { fn(event, detail); } catch { /* ignore */ }
  });
}

export const EVENTS = {
  DATA_CHANGED:    'data:changed',    // { table }
  SYNC_STATE:      'sync:state',      // 'synced' | 'syncing' | 'offline' | 'error' | 'local'
  AUTH_CHANGED:    'auth:changed',
  INSTALL_CHANGED: 'install:changed',
};

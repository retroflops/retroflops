// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Reads an island's state from the URL now and again on every back or forward
 * navigation, so the query string stays the one source of truth. Returns the
 * unsubscribe function, which makes it an effect body as it stands.
 */
export function followLocation(restore: (search: string) => void): () => void {
  const sync = (): void => restore(globalThis.location.search);
  sync();
  globalThis.addEventListener('popstate', sync);
  return () => globalThis.removeEventListener('popstate', sync);
}

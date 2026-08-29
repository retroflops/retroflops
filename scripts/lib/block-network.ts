// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Network kill switch, loaded with `node --import`.
 *
 * The production build must never fetch anything: all data comes from files
 * that were reviewed and committed. This makes that guarantee testable rather
 * than aspirational, any outbound connection throws instead of succeeding, so
 * a build step that quietly gained a network dependency fails loudly in CI.
 *
 * DNS and socket creation are blocked as well as `fetch`, because a library can
 * reach the network without going through it.
 */

import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';

class NetworkBlockedError extends Error {
  constructor(what: string, target: string) {
    super(
      `Network access is blocked during this build (${what} → ${target}). ` +
        'The production build must read only committed data; run pnpm data:fetch separately.',
    );
    this.name = 'NetworkBlockedError';
  }
}

globalThis.fetch = ((input: unknown): never => {
  const target =
    typeof input === 'string' ? input : ((input as { url?: string } | null)?.url ?? 'unknown');
  throw new NetworkBlockedError('fetch', target);
}) as typeof globalThis.fetch;

const blockedConnect = (what: string) =>
  function connect(...args: unknown[]): never {
    const first = args[0];
    const target =
      typeof first === 'object' && first !== null
        ? `${(first as { host?: string }).host ?? 'unknown'}:${(first as { port?: number }).port ?? ''}`
        : String(first);
    throw new NetworkBlockedError(what, target);
  };

net.connect = blockedConnect('net.connect') as typeof net.connect;
net.createConnection = blockedConnect('net.createConnection') as typeof net.createConnection;
tls.connect = blockedConnect('tls.connect') as typeof tls.connect;

const blockedLookup = function lookup(hostname: string): never {
  throw new NetworkBlockedError('dns.lookup', hostname);
};

dns.lookup = blockedLookup as unknown as typeof dns.lookup;
dns.promises.lookup = blockedLookup as unknown as typeof dns.promises.lookup;

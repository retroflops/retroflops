// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import type { Source } from './schema.ts';

/** Returns the URL a reader can use to re-check a source. */
export function sourceCitationUrl(
  source: Pick<Source, 'url' | 'urlStatus' | 'archiveUrl'>,
): string | undefined {
  if (source.urlStatus === 'known-unavailable') {
    return source.archiveUrl;
  }
  return source.url ?? source.archiveUrl;
}

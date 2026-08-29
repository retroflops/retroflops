// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Content collections.
 *
 * Methodology pages are prose rather than data, so they live as Markdown with a
 * schema that keeps the front matter honest: every page states its own title,
 * its position in the reading order and a summary used for the index and the
 * page description.
 *
 * Comparison presets are editorial too. What a preset contributes is the
 * judgment that two machines are worth putting next to each other and the prose
 * explaining what the comparison does and does not show; the figures themselves
 * still come from the catalog, and the comparability rules still decide which
 * of them may be divided. That is why a preset lives here rather than in
 * `catalog-v1`: it is an argument about the data, not part of it.
 */

import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

const methodology = defineCollection({
  loader: glob({ base: './src/content/methodology', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string().min(1),
    /** Reading order. The files are numbered too, but the number is not the contract. */
    order: z.number().int().min(1),
    summary: z.string().min(1),
  }),
});

const presets = defineCollection({
  loader: glob({ base: './src/content/presets', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string().min(1),
    order: z.number().int().min(1),
    summary: z.string().min(1),
    /** Whole systems or components; a preset never mixes the two. */
    kind: z.enum(['system', 'component']),
    /**
     * Records to compare, as the slugs the URLs use, optionally naming a variant
     * after `@`. The build refuses a preset whose records do not resolve, so a
     * renamed record breaks the build rather than shipping a broken page.
     */
    records: z
      .array(z.string().regex(/^[a-z0-9-]+(?:@[a-z0-9-]+)?$/))
      .min(2)
      .max(4),
    /** Shown on Home when the preset is promoted there. */
    promoted: z.boolean().default(false),
  }),
});

export const collections = { methodology, presets };

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
 *
 * Trivia follows the same reasoning a third time. The games people remember a
 * machine for, and the event that put it in a headline, are arguments about the
 * machine rather than properties of it, so they are not `catalog-v1` fields.
 * They are Markdown because a list of games is a list, and a YAML scalar cannot
 * hold one.
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

const trivia = defineCollection({
  /**
   * One file per machine, named for the system slug. The directory stays flat
   * on purpose, because the glob loader turns a nested file into an id of
   * `subdir/slug`, which can never match a slug and fails with a confusing
   * message.
   */
  loader: glob({ base: './src/content/trivia', pattern: '*.md' }),
  schema: z.object({
    /**
     * The section heading. Per entry rather than fixed, because "Trivia" is the
     * right word for the Atari 2600 and the wrong one for the Apollo Guidance
     * Computer, where the 1202 alarm is a documented event in a flight record.
     * The anchor is `#trivia` on every profile regardless, so the heading can
     * vary without the link doing so.
     */
    title: z.string().min(1),
    /**
     * The documents this entry rests on, as ids from `data/sources`.
     *
     * Trivia is exempt from the A/B/C tiers for the same reason a photograph is.
     * The tiers are a rule about numeric evidence, and no figure here rests on
     * any of this. Citation still applies. An entry with no source is somebody's
     * recollection, and a recollection has no locator, which is this project's
     * whole objection to a language model's answer.
     */
    sourceIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
  }),
});

export const collections = { methodology, presets, trivia };

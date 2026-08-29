// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { z } from 'zod';

export const UNKNOWN_REPAIR_BASELINE = '99c5bc2ca113964ff77cde4f9cf0cca9faa323f9' as const;
export const UNKNOWN_REPAIR_BASELINE_COUNT = 254;
/** Every ledger entry is now reviewed, so the ceiling is where v1 needs it. */
export const UNREVIEWED_UNKNOWN_BUDGET = 0;

export const UNKNOWN_REPAIR_DISPOSITIONS = [
  'unreviewed',
  'confirmed',
  'reported',
  'rumored',
  'conflict',
  'not-applicable',
  'true-unknown',
] as const;

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:[-:][a-z0-9]+)*$/, 'must be a lowercase identifier');

export const unknownRepairLedgerSchema = z.object({
  version: z.literal('unknown-repair-v1'),
  baselineCommit: z.literal(UNKNOWN_REPAIR_BASELINE),
  entries: z.array(
    z.object({
      measurementId: identifier,
      disposition: z.enum(UNKNOWN_REPAIR_DISPOSITIONS),
      targetIds: z.array(identifier).default([]),
      reviewedOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
        .optional(),
    }),
  ),
});

export type UnknownRepairLedger = z.infer<typeof unknownRepairLedgerSchema>;

// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import {
  unknownRepairLedgerSchema,
  type UnknownRepairLedger,
} from '../../src/lib/data/unknown-repair.ts';
import { repoPath, readYamlFile } from './io.ts';

export const UNKNOWN_REPAIR_LEDGER_PATH = repoPath('data/audits/unknown-repair-v1.yaml');

export async function loadUnknownRepairLedger(): Promise<UnknownRepairLedger> {
  return unknownRepairLedgerSchema.parse(await readYamlFile(UNKNOWN_REPAIR_LEDGER_PATH));
}

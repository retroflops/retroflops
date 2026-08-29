// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { containsMarker, containsRawQuantity, resolveEditorialText } from './editorial-text.ts';
import type { ContextClaim, Measurement } from './schema.ts';

const measurement = (id: string, quantity: Measurement['quantity']): Measurement => ({
  id,
  subject: { kind: 'system', id: 'machine' },
  metric: 'clock-frequency',
  quantity,
  scope: 'cpu',
  method: 'nominal-clock',
  provenance: 'vendor',
  evidenceStage: 'shipped',
  comparabilityGroup: 'clock-frequency|cpu|nominal-clock',
  rounding: 'none',
  status: 'vendor-rated',
  evidenceLevel: quantity.state === 'value' ? 'confirmed' : undefined,
  editorialStatus: 'approved',
  sourceIds: ['manual'],
});

const contextClaim: ContextClaim = {
  id: 'processor:core-count',
  subject: { kind: 'component', id: 'processor' },
  label: 'Core count',
  quantity: { state: 'value', value: '8', unit: 'unit', significantDigits: 1 },
  provenance: 'vendor',
  evidenceStage: 'shipped',
  status: 'vendor-rated',
  evidenceLevel: 'confirmed',
  editorialStatus: 'approved',
  sourceIds: ['manual'],
};

describe('editorial reference resolver', () => {
  const measurements = new Map<string, Measurement>([
    [
      'clock',
      measurement('clock', { state: 'value', value: '3.5', unit: 'GHz', significantDigits: 2 }),
    ],
    ['missing', measurement('missing', { state: 'unknown' })],
    ['absent', measurement('absent', { state: 'not-applicable' })],
    [
      'memory',
      {
        ...measurement('memory', {
          state: 'value',
          value: '128',
          unit: 'KiB',
          significantDigits: 3,
        }),
        metric: 'memory-capacity',
        scope: 'memory',
        method: 'design-capacity',
        comparabilityGroup: 'memory-capacity|memory|design-capacity',
      },
    ],
  ]);
  const claims = new Map([[contextClaim.id, contextClaim]]);

  it('renders values, absences, units and contextual counts deterministically', () => {
    const source =
      '{{measurement:clock}}; {{measurement:missing}}; {{measurement:absent}}; ' +
      '{{measurement:memory}}; {{context:processor:core-count}} cores';
    const expected = '3.5 GHz; unknown; not applicable; 128 KiB; 8 cores';
    expect(resolveEditorialText(source, measurements, claims)).toBe(expected);
    expect(resolveEditorialText(source, measurements, claims)).toBe(expected);
  });

  it('detects unresolved markers and raw quantities without rejecting model identifiers', () => {
    expect(containsMarker('{{measurement:missing-id}}')).toBe(true);
    expect(containsRawQuantity('Runs at 3.5 GHz with 8 cores.')).toBe(true);
    expect(containsRawQuantity('Motorola 68000 and RDNA 2 are model names.')).toBe(false);
  });
});

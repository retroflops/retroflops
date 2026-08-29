// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { getCatalog } from './catalog.ts';

const catalog = getCatalog();

function measurement(id: string) {
  const found = catalog.measurements.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`missing measurement ${id}`);
  }
  return found;
}

describe('consumer graphics-card catalog', () => {
  it('adds the ten requested graphics accelerators', () => {
    const requested = [
      '3dfx-voodoo-graphics',
      'nvidia-geforce-256',
      'ati-radeon-9700-pro',
      'nvidia-geforce-6800-ultra',
      'nvidia-geforce-8800-gtx',
      'nvidia-geforce-gtx-580',
      'nvidia-geforce-gtx-780-ti',
      'nvidia-geforce-rtx-2080-ti',
      'nvidia-geforce-rtx-4090',
      'amd-radeon-rx-7900-xtx',
    ];

    // Six records became provisional when their listed product briefs could not
    // be retrieved. The URLs returned 404. The records remain in the catalog
    // while we find replacement sources; only their confidence changed.
    expect(
      Object.fromEntries(
        requested.map((slug) => [
          slug,
          catalog.systems.find((system) => system.slug === slug)?.editorialStatus,
        ]),
      ),
    ).toEqual({
      '3dfx-voodoo-graphics': 'provisional',
      'nvidia-geforce-256': 'provisional',
      'ati-radeon-9700-pro': 'approved',
      'nvidia-geforce-6800-ultra': 'provisional',
      'nvidia-geforce-8800-gtx': 'provisional',
      'nvidia-geforce-gtx-580': 'provisional',
      'nvidia-geforce-gtx-780-ti': 'provisional',
      'nvidia-geforce-rtx-2080-ti': 'approved',
      'nvidia-geforce-rtx-4090': 'approved',
      'amd-radeon-rx-7900-xtx': 'approved',
    });
  });

  it('keeps the Voodoo FP32 row absent and marks the GeForce 256 table figure as rumored', () => {
    expect(measurement('3dfx-voodoo-graphics:peak-fp32-rate').quantity).toMatchObject({
      state: 'unknown',
    });
    expect(measurement('nvidia-nv10:peak-fp32-rate')).toMatchObject({
      evidenceLevel: 'rumored',
      editorialStatus: 'provisional',
      quantity: { state: 'value', value: '960', unit: 'MFLOP/s' },
    });
  });

  it('keeps the GeForce 256 SDR and DDR reference configurations distinct', () => {
    const system = catalog.systems.find((candidate) => candidate.id === 'nvidia-geforce-256');
    expect(system?.configurations.map((configuration) => configuration.id)).toEqual([
      'sdr-32mb',
      'ddr-32mb',
    ]);
    expect(measurement('nvidia-geforce-256:sdr-32mb:whole-system-memory-bandwidth')).toMatchObject({
      quantity: { state: 'value', value: '2.656', unit: 'GB/s' },
      evidenceLevel: 'rumored',
      subject: { configurationId: 'sdr-32mb' },
    });
    expect(measurement('nvidia-geforce-256:ddr-32mb:whole-system-memory-bandwidth')).toMatchObject({
      quantity: { state: 'value', value: '4.800', unit: 'GB/s' },
      evidenceLevel: 'rumored',
      subject: { configurationId: 'ddr-32mb' },
    });
  });

  it('records AMD game and boost clocks separately and ties FP32 to boost', () => {
    expect(measurement('amd-navi31:clock-frequency-base').quantity).toMatchObject({
      value: '2300',
      unit: 'MHz',
    });
    expect(measurement('amd-navi31:clock-frequency-boost').quantity).toMatchObject({
      value: '2500',
      unit: 'MHz',
    });
    expect(measurement('amd-navi31:peak-fp32-rate').conditions).toContain('2500 MHz boost clock');
  });
});

// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { ComparabilityFacets } from './comparability.ts';
import {
  getFormula,
  type FormulaInput,
  type FormulaOutcome,
  type FormulaResult,
} from './formulas.ts';

const ratio = getFormula('ratio', '1');
if (ratio === undefined) {
  throw new Error('the ratio formula is missing from the registry');
}

const peakFp32: ComparabilityFacets = {
  metric: 'peak-fp32-rate',
  unit: 'FLOP/s',
  scope: 'gpu',
  method: 'theoretical-peak',
  status: 'theoretical',
  editorialStatus: 'approved',
};

function input(
  value: string,
  significantDigits: number,
  facets: ComparabilityFacets = peakFp32,
): FormulaInput {
  return { facets, value, significantDigits };
}

function spec(version: string): ComparabilityFacets {
  return {
    metric: 'spec-cpu-result',
    unit: 'score',
    scope: 'cpu',
    method: 'spec-published-result',
    benchmark: { id: 'spec-cpu2006', version },
    status: 'vendor-rated',
    editorialStatus: 'approved',
  };
}

/** Unwraps a successful outcome, failing loudly rather than skipping assertions. */
function resultOf(outcome: FormulaOutcome): FormulaResult {
  if (!outcome.ok) {
    throw new Error(`expected a result, but the formula refused: ${outcome.reasons.join(', ')}`);
  }
  return outcome.result;
}

/** Unwraps a refusal, so a formula that unexpectedly succeeds fails the test. */
function refusalOf(outcome: FormulaOutcome): readonly string[] {
  if (outcome.ok) {
    throw new Error(`expected a refusal, but the formula returned ${outcome.result.value}`);
  }
  return outcome.reasons;
}

describe('ratio formula', () => {
  it('is registered under an explicit version', () => {
    expect(getFormula('ratio', '1')).toBeDefined();
    expect(getFormula('ratio', '2')).toBeUndefined();
  });

  it('divides two figures from the same comparability group', () => {
    const result = resultOf(
      ratio.compute([input('10280000000000', 6), input('66500000', 6)], {
        significantDigits: 6,
        rounding: 'half-up',
      }),
    );
    expect(result.value).toBe('154586');
    expect(result.unit).toBe('unit');
  });

  it('is no more precise than its least precise input', () => {
    // The same division as above, but the divisor is only known to three digits,
    // so reporting 154586 would invent precision no source ever had.
    const threeDigits = resultOf(
      ratio.compute([input('10280000000000', 4), input('66500000', 3)], {
        significantDigits: 6,
        rounding: 'half-up',
      }),
    );
    expect(threeDigits.significantDigits).toBe(3);
    expect(threeDigits.value).toBe('155000');

    const twoDigits = resultOf(
      ratio.compute([input('10280000000000', 4), input('66500000', 2)], {
        significantDigits: 6,
        rounding: 'half-up',
      }),
    );
    expect(twoDigits.significantDigits).toBe(2);
    expect(twoDigits.value).toBe('150000');
  });

  it('generates a caveat naming the metric, scope, method and precision', () => {
    const result = resultOf(
      ratio.compute([input('4', 1), input('2', 1)], { significantDigits: 6, rounding: 'half-up' }),
    );
    expect(result.caveat).toContain('peak-fp32-rate');
    expect(result.caveat).toContain('theoretical-peak');
    expect(result.caveat).toContain('1 significant digit');
  });

  it('refuses inputs from different metrics', () => {
    const mips: ComparabilityFacets = {
      metric: 'native-instruction-rate',
      unit: 'IPS',
      scope: 'cpu',
      method: 'theoretical-peak',
      status: 'vendor-rated',
      editorialStatus: 'approved',
    };
    expect(
      refusalOf(
        ratio.compute([input('1000', 4), input('100', 3, mips)], {
          significantDigits: 6,
          rounding: 'half-up',
        }),
      ),
    ).toContain('metric-mismatch');
  });

  it('refuses a metric that forbids ratios', () => {
    const tdp: ComparabilityFacets = {
      metric: 'thermal-design-power',
      unit: 'W',
      scope: 'cpu',
      method: 'rated-power',
      status: 'vendor-rated',
      editorialStatus: 'approved',
    };
    expect(
      refusalOf(
        ratio.compute([input('95', 2, tdp), input('65', 2, tdp)], {
          significantDigits: 6,
          rounding: 'half-up',
        }),
      ),
    ).toContain('metric-forbids-ratio');
  });

  it('names an estimate among its inputs in the caveat', () => {
    // An estimate is comparable, the group and the editorial status decide that
    // but the multiplier must not read as firmer than what it was built from.
    const estimate = { ...peakFp32, status: 'estimated' } as const;
    const result = resultOf(
      ratio.compute([input('4', 1), input('2', 1, estimate)], {
        significantDigits: 6,
        rounding: 'half-up',
      }),
    );
    expect(result.caveat).toContain('estimate computed by a third party');
  });

  it('refuses a provisional record', () => {
    const provisional = { ...peakFp32, editorialStatus: 'provisional' } as const;
    expect(
      refusalOf(
        ratio.compute([input('4', 1), input('2', 1, provisional)], {
          significantDigits: 6,
          rounding: 'half-up',
        }),
      ),
    ).toContain('provisional-record');
  });

  it('refuses figures from different benchmark versions', () => {
    expect(
      refusalOf(
        ratio.compute([input('40', 2, spec('1.2')), input('20', 2, spec('1.1'))], {
          significantDigits: 6,
          rounding: 'half-up',
        }),
      ),
    ).toContain('benchmark-mismatch');
  });
});

const sum = getFormula('sum', '1');
if (sum === undefined) {
  throw new Error('the sum formula is missing from the registry');
}

const capacity: ComparabilityFacets = {
  metric: 'memory-capacity',
  unit: 'B',
  scope: 'memory',
  method: 'design-capacity',
  status: 'vendor-rated',
  editorialStatus: 'approved',
};

function pool(value: string, significantDigits: number, facets = capacity): FormulaInput {
  return { facets, value, significantDigits };
}

describe('sum formula', () => {
  it('adds normalized figures exactly and reports in the base unit', () => {
    // 512 KiB of chip memory and 512 KiB more, in bytes.
    const result = resultOf(
      sum.compute([pool('524288', 6), pool('524288', 6)], {
        significantDigits: 7,
        rounding: 'none',
      }),
    );
    expect(result.value).toBe('1048576');
    expect(result.unit).toBe('B');
  });

  it('accepts a single term, because a total of one pool is still a decision', () => {
    const result = resultOf(
      sum.compute([pool('65536', 2)], { significantDigits: 5, rounding: 'none' }),
    );
    expect(result.value).toBe('65536');
    expect(result.significantDigits).toBe(5);
  });

  it('never reports more digits than the exact total has', () => {
    const result = resultOf(
      sum.compute([pool('65536', 2)], { significantDigits: 12, rounding: 'none' }),
    );
    expect(result.significantDigits).toBe(5);
  });

  it('names the exclusions in the generated caveat', () => {
    const result = resultOf(
      sum.compute([pool('65536', 6)], {
        significantDigits: 6,
        rounding: 'half-up',
        exclusions: [
          {
            measurementId: 'c64-system-rom:capacity',
            label: '20 KiB of system ROM',
            reason: 'read-only, so it is not memory the machine can write to',
          },
        ],
      }),
    );
    expect(result.caveat).toContain('{{measurement:c64-system-rom:capacity}}');
    expect(result.caveat).toContain('read-only');
  });

  it('says so when nothing was left out', () => {
    const result = resultOf(
      sum.compute([pool('65536', 6)], { significantDigits: 6, rounding: 'half-up' }),
    );
    expect(result.caveat).toContain('Nothing in the catalog is left out of it');
  });

  it('refuses to add figures obtained by different methods', () => {
    const announced = { ...capacity, method: 'theoretical-peak' } as const;
    expect(
      refusalOf(
        sum.compute([pool('1', 1), pool('1', 1, announced)], {
          significantDigits: 6,
          rounding: 'half-up',
        }),
      ),
    ).toContain('method-mismatch');
  });

  it('adds a provisional term, unlike the ratio, because a total claims nothing new', () => {
    // The rule provisional records enforce is that an announcement never becomes
    // an "N× faster" claim, and that rule lives in the ratio. Refusing here would
    // mean a console whose bandwidth was only ever announced could state no
    // machine-level bandwidth at all. Validation keeps the total provisional.
    const provisional = { ...capacity, editorialStatus: 'provisional' } as const;
    const result = resultOf(
      sum.compute([pool('1', 1), pool('1', 1, provisional)], {
        significantDigits: 1,
        rounding: 'none',
      }),
    );
    expect(result.value).toBe('2');
  });
});

describe('clock-from-peak-fp32@1', () => {
  const clockFromPeak = getFormula('clock-from-peak-fp32', '1');
  if (clockFromPeak === undefined) {
    throw new Error('the clock-from-peak-fp32 formula is missing from the registry');
  }

  const constants = [
    {
      id: 'lanes',
      label: 'lanes',
      value: '1152',
      reason: 'eighteen compute units at sixty-four lanes each',
      sourceIds: ['vendor-release'],
    },
    {
      id: 'flops-per-lane-per-clock',
      label: 'floating-point operations per lane per clock',
      value: '2',
      reason: 'one fused multiply-add counted as two operations',
      sourceIds: ['vendor-release'],
    },
  ];

  it('recovers the frequency hiding inside a published peak', () => {
    // Sony gave the PlayStation 4 1.84 teraflops and eighteen compute units and
    // no megahertz. 1.84e12 ÷ 2304 is 798.6 MHz, which rounds to the three
    // digits the published rate carries, and lands beside the 800 MHz two
    // independent publications state.
    const result = resultOf(
      clockFromPeak.compute([input('1840000000000', 3)], {
        significantDigits: 3,
        rounding: 'half-up',
        constants,
      }),
    );
    expect(result.value).toBe('799000000');
    expect(result.unit).toBe('Hz');
    expect(result.significantDigits).toBe(3);
    expect(result.caveat).toContain('lanes × floating-point operations per lane per clock');
    expect(result.caveat).toContain('3 significant digits');
  });

  it('refuses to run without the constants it divides by', () => {
    const outcome = clockFromPeak.compute([input('1840000000000', 3)], {
      significantDigits: 3,
      rounding: 'half-up',
    });
    expect(refusalOf(outcome)).toEqual([
      'missing-constant:lanes',
      'missing-constant:flops-per-lane-per-clock',
    ]);
  });

  it('refuses a figure that is not a single-precision peak', () => {
    const outcome = clockFromPeak.compute([input('1840000000000', 3, spec('1.2'))], {
      significantDigits: 3,
      rounding: 'half-up',
      constants,
    });
    expect(refusalOf(outcome)).toContain('metric-mismatch');
  });

  it('refuses a lane count of zero rather than dividing by it', () => {
    const outcome = clockFromPeak.compute([input('1840000000000', 3)], {
      significantDigits: 3,
      rounding: 'half-up',
      constants: [
        { ...(constants[0] as (typeof constants)[number]), value: '0' },
        constants[1] as (typeof constants)[number],
      ],
    });
    expect(refusalOf(outcome)).toContain('non-positive-constant:lanes');
  });
});

describe('power-from-voltage-current@1', () => {
  const formula = getFormula('power-from-voltage-current', '1');
  if (formula === undefined) {
    throw new Error('the power-from-voltage-current formula is missing from the registry');
  }

  const voltage: ComparabilityFacets = {
    metric: 'supply-voltage',
    unit: 'V',
    scope: 'whole-system',
    method: 'nameplate-rating',
    status: 'vendor-rated',
    editorialStatus: 'approved',
  };
  const current: ComparabilityFacets = { ...voltage, metric: 'supply-current', unit: 'A' };

  it('multiplies the GameCube nameplate into watts', () => {
    const outcome = formula.compute([input('12', 2, voltage), input('3.25', 3, current)], {
      significantDigits: 3,
      rounding: 'half-up',
    });
    const result = resultOf(outcome);
    expect(result.value).toBe('39');
    expect(result.unit).toBe('W');
    // Two digits, the precision of the less precise half of the rating.
    expect(result.significantDigits).toBe(2);
    expect(result.caveat).toContain('not a draw');
  });

  it('multiplies the Switch adapter’s higher output mode into the same figure', () => {
    const outcome = formula.compute([input('15.0', 3, voltage), input('2.6', 2, current)], {
      significantDigits: 3,
      rounding: 'half-up',
    });
    expect(resultOf(outcome).value).toBe('39');
  });

  it('refuses the two halves given in the wrong order', () => {
    const outcome = formula.compute([input('3.25', 3, current), input('12', 2, voltage)], {
      significantDigits: 3,
      rounding: 'half-up',
    });
    expect(refusalOf(outcome)).toEqual([
      'metric-mismatch:supply-voltage',
      'metric-mismatch:supply-current',
      'unit-quantity-mismatch:voltage',
      'unit-quantity-mismatch:current',
    ]);
  });

  it('refuses a voltage and a current recorded at different scopes', () => {
    const outcome = formula.compute(
      [input('12', 2, voltage), input('3.25', 3, { ...current, scope: 'gpu' })],
      { significantDigits: 3, rounding: 'half-up' },
    );
    expect(refusalOf(outcome)).toContain('scope-mismatch');
  });
});

describe('memory-bandwidth-from-transfer-rate@1', () => {
  const formula = getFormula('memory-bandwidth-from-transfer-rate', '1');
  if (formula === undefined) {
    throw new Error('the memory-bandwidth-from-transfer-rate formula is missing from the registry');
  }

  const rate: ComparabilityFacets = {
    metric: 'memory-transfer-rate',
    unit: 'T/s',
    scope: 'memory',
    method: 'nominal-transfer-rate',
    status: 'vendor-rated',
    editorialStatus: 'approved',
  };
  const width: ComparabilityFacets = {
    metric: 'memory-bus-width',
    unit: 'bit',
    scope: 'memory',
    method: 'design-capacity',
    status: 'vendor-rated',
    editorialStatus: 'approved',
  };

  it('turns the Steam Deck’s specification into 88 GB/s', () => {
    const outcome = formula.compute([input('5500000000', 2, rate), input('128', 3, width)], {
      significantDigits: 3,
      rounding: 'half-up',
    });
    const result = resultOf(outcome);
    expect(result.value).toBe('88000000000');
    expect(result.unit).toBe('B/s');
    // The width is a count of lines and exact, so only the rate limits precision.
    expect(result.significantDigits).toBe(2);
  });

  it('refuses a bandwidth given where a transfer rate belongs', () => {
    const outcome = formula.compute(
      [
        input('88000000000', 2, { ...rate, metric: 'memory-bandwidth', unit: 'B/s' }),
        input('128', 3, width),
      ],
      { significantDigits: 3, rounding: 'half-up' },
    );
    expect(refusalOf(outcome)).toEqual([
      'metric-mismatch:memory-transfer-rate',
      'unit-quantity-mismatch:transfer-rate',
    ]);
  });

  it('refuses a bus width of zero', () => {
    const outcome = formula.compute([input('5500000000', 2, rate), input('0', 1, width)], {
      significantDigits: 3,
      rounding: 'half-up',
    });
    expect(refusalOf(outcome)).toContain('non-positive-value');
  });
});

describe('price-adjusted-by-cpi@1', () => {
  const formula = getFormula('price-adjusted-by-cpi', '1');
  if (formula === undefined) {
    throw new Error('the price-adjusted-by-cpi formula is missing from the registry');
  }

  const price: ComparabilityFacets = {
    metric: 'launch-price',
    unit: 'USD',
    scope: 'whole-system',
    method: 'list-price',
    status: 'vendor-rated',
    editorialStatus: 'approved',
  };

  const cpi = [
    {
      id: 'target-cpi-u',
      label: 'CPI-U for July 2026',
      value: '333.918',
      reason: 'The frozen target-month observation.',
      sourceIds: ['bls-cpi-u-july-2026'],
    },
    {
      id: 'launch-cpi-u',
      label: 'CPI-U for June 2007',
      value: '208.352',
      reason: 'The launch-month observation.',
      sourceIds: ['bls-cpi-u-july-2026'],
    },
  ] as const;

  it('restates the first iPhone list price in the frozen target month’s dollars', () => {
    const outcome = formula.compute([input('499', 3, price)], {
      significantDigits: 3,
      rounding: 'half-up',
      constants: cpi,
    });
    const result = resultOf(outcome);
    expect(result.value).toBe('800');
    expect(result.unit).toBe('USD');
    expect(result.significantDigits).toBe(3);
    expect(result.caveat).toContain('CPI-U for July 2026');
    expect(result.caveat).toContain('does not convert currencies or markets');
  });

  it('refuses a non-price input and a missing CPI observation', () => {
    const outcome = formula.compute([input('499', 3, { ...price, metric: 'peak-fp32-rate' })], {
      significantDigits: 3,
      rounding: 'half-up',
      constants: [cpi[0]],
    });
    expect(refusalOf(outcome)).toEqual([
      'metric-mismatch:launch-price',
      'missing-constant:launch-cpi-u',
    ]);
  });
});

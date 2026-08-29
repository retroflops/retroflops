// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The category and family lookups, against the real catalog.
 *
 * Fixtures would prove the functions sort and filter. What matters instead is
 * that the navigation they drive is correct for the records that actually
 * exist, that the PlayStation page really does reach the other four, and that
 * the machines with no lineage really do get nothing rather than a box of one.
 */

import { describe, expect, it } from 'vitest';

import { getComponents, getSystems } from './catalog.ts';
import { SYSTEM_FAMILIES, type Component, type System } from './data/schema.ts';
import {
  componentCrumbs,
  componentFamilyNav,
  systemCrumbs,
  systemFamilyLabel,
  systemFamilyNav,
  systemsOfType,
  systemTypesInUse,
} from './families.ts';
import { breadcrumbList } from './structured-data.ts';

function system(slug: string): System {
  const found = getSystems().find((candidate) => candidate.slug === slug);
  if (found === undefined) {
    throw new Error(`no system "${slug}" in the catalog`);
  }
  return found;
}

function componentRecord(kind: Component['kind'], slug: string): Component {
  const found = getComponents().find(
    (candidate) => candidate.kind === kind && candidate.slug === slug,
  );
  if (found === undefined) {
    throw new Error(`no ${kind} component "${slug}" in the catalog`);
  }
  return found;
}

describe('system families', () => {
  it('names every family in the vocabulary', () => {
    for (const family of SYSTEM_FAMILIES) {
      expect(systemFamilyLabel(family).length).toBeGreaterThan(0);
    }
  });

  it('reaches the whole PlayStation line from the first one', () => {
    const nav = systemFamilyNav(system('sony-playstation'));
    expect(nav?.label).toBe('PlayStation');
    expect(nav?.items.map((item) => item.path)).toEqual([
      '/systems/sony-playstation/',
      '/systems/sony-playstation-2/',
      '/systems/sony-playstation-3/',
      '/systems/sony-playstation-4/',
      '/systems/sony-playstation-5/',
    ]);
  });

  it('crosses the manufacturer split the record carries', () => {
    // The whole reason the field is curated: these two say different firms.
    const amiga = systemFamilyNav(system('amiga-500'));
    expect(amiga?.items.map((item) => item.name)).toEqual([
      'Commodore Amiga 500',
      'Commodore Amiga 1200',
      'Commodore Amiga 4000',
    ]);
    expect(system('amiga-500').manufacturer).not.toBe(system('amiga-1200').manufacturer);
  });

  it('marks exactly one item as the page it is on', () => {
    const nav = systemFamilyNav(system('sony-playstation-3'));
    expect(nav?.items.filter((item) => item.current).map((item) => item.name)).toEqual([
      'Sony PlayStation 3',
    ]);
  });

  it('gives no navbox at all to a machine with no lineage', () => {
    expect(systemFamilyNav(system('sgi-octane'))).toBeUndefined();
    expect(systemFamilyNav(system('commodore-64'))).toBeUndefined();
  });

  it('never renders a navbox of one, for any machine in the catalog', () => {
    const lonely = getSystems()
      .map((record) => ({ slug: record.slug, nav: systemFamilyNav(record) }))
      .filter((entry) => entry.nav !== undefined && entry.nav.items.length < 2)
      .map((entry) => entry.slug);
    expect(lonely).toEqual([]);
  });

  it('points every navbox at the category its members share', () => {
    const wrong = getSystems()
      .map((record) => ({ record, nav: systemFamilyNav(record) }))
      .filter(
        (entry) =>
          entry.nav !== undefined &&
          entry.nav.category.path !== `/systems/type/${entry.record.type}/`,
      )
      .map((entry) => entry.record.slug);
    expect(wrong).toEqual([]);
  });
});

describe('component families', () => {
  it('groups a processor by the lineage it already carried', () => {
    const nav = componentFamilyNav(componentRecord('cpu', 'intel-8086'));
    expect(nav?.label).toBe('x86 processors');
    expect(nav?.items.filter((item) => item.current)).toHaveLength(1);
  });

  it('gives memory and graphics no navbox, having no lineage to give them', () => {
    const boxed = getComponents()
      .filter((record) => record.kind !== 'cpu' && componentFamilyNav(record) !== undefined)
      .map((record) => record.id);
    expect(boxed).toEqual([]);
  });
});

describe('categories', () => {
  it('publishes a category only for the types that have records', () => {
    const types = systemTypesInUse();
    expect(types).not.toContain('mainframe');
    expect(types).not.toContain('minicomputer');
    // Every published category has machines, and between them they hold all 78.
    expect(types.filter((type) => systemsOfType(type).length === 0)).toEqual([]);
    const total = types.reduce((sum, type) => sum + systemsOfType(type).length, 0);
    expect(total).toBe(getSystems().length);
  });

  it('lists a category oldest first', () => {
    const dates = systemsOfType('console').map((record) => record.releaseDate);
    expect(dates).toEqual([...dates].toSorted());
  });
});

describe('breadcrumbs', () => {
  it('names the category between Explore and the machine', () => {
    expect(systemCrumbs(system('sony-playstation')).map((crumb) => crumb.path)).toEqual([
      '/',
      '/explore/',
      '/systems/type/console/',
      '/systems/sony-playstation/',
    ]);
  });

  it('ends a component trail at the component', () => {
    const crumbs = componentCrumbs(componentRecord('cpu', 'intel-8086'));
    expect(crumbs.at(-1)?.path).toBe('/components/cpu/intel-8086/');
    expect(crumbs.at(-2)?.path).toBe('/components/cpu/');
  });

  it('serializes the same array the page renders', () => {
    // The point of sharing the array: JSON-LD cannot describe a trail the
    // reader cannot walk, because there is only one trail.
    const crumbs = systemCrumbs(system('amiga-500'));
    const jsonLd = breadcrumbList(crumbs, (path) => `https://example.test${path}`);
    const items = jsonLd['itemListElement'];
    expect(Array.isArray(items) && items.length).toBe(crumbs.length);
  });
});

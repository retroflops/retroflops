// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Categories and families, as the record pages navigate them.
 *
 * A profile used to be a dead end: the Amiga 500 named no route to the Amiga
 * 1200, and the PlayStation named none to the four machines that followed it.
 * Two links fix that, one up to the category, one sideways to the lineage,
 * and both need the same thing from the catalog, which is why they are
 * computed here rather than twice in two `.astro` files.
 *
 * Server-only. This reaches `catalog.ts` and therefore Zod, so an island must
 * never import it; that is the same constraint that split `facet-groups.ts` out
 * of `facets.ts`, and it costs about 55 kB when it is broken.
 */

import { getComponents, getSystems } from './catalog.ts';
import type { Component, System, SystemFamily, SystemType } from './data/schema.ts';
import { COMPONENT_KINDS, SYSTEM_FAMILIES } from './data/schema.ts';
import {
  componentKindLabel,
  formatPartialDate,
  humaniseIdentifier,
  instructionSetLabel,
  systemTypeLabel,
  systemTypesByFirstRelease,
} from './display.ts';
import type { Crumb } from './structured-data.ts';

/**
 * What a lineage is called when it is written above a list of its members.
 *
 * `humaniseIdentifier` would render "Sony playstation" and "Reference pc",
 * readable enough to ship and wrong enough to notice, the same reason
 * `ROLE_LABELS` exists in `display.ts`. The identifiers stay maker-qualified
 * because they are keys and must not collide; the labels drop the maker where
 * the product name already carries it.
 */
const SYSTEM_FAMILY_LABELS: Record<SystemFamily, string> = {
  'apple-iphone': 'iPhone',
  'apple-macintosh': 'Macintosh',
  'commodore-amiga': 'Amiga',
  'microsoft-xbox': 'Xbox',
  'nintendo-handheld': 'Nintendo handhelds',
  'nintendo-home-console': 'Nintendo home consoles',
  'nvidia-geforce': 'GeForce',
  radeon: 'Radeon',
  'reference-pc': 'Reference PCs',
  'sega-console': 'Sega consoles',
  'sony-playstation': 'PlayStation',
};

export function systemFamilyLabel(family: SystemFamily): string {
  return SYSTEM_FAMILY_LABELS[family];
}

/** Oldest first, so a lineage reads as the sequence it was. */
function byRelease(a: System, b: System): number {
  return a.releaseDate.localeCompare(b.releaseDate);
}

/**
 * The types that have records, in the order Explore lists their machines.
 *
 * `SYSTEM_TYPES` contains `mainframe` and `minicomputer`, which nothing in the
 * catalog is yet. Building a category page for them would publish two empty
 * routes and put two empty links in the sitemap.
 */
export function systemTypesInUse(): readonly SystemType[] {
  return systemTypesByFirstRelease(getSystems());
}

export function systemsOfType(type: SystemType): readonly System[] {
  return getSystems()
    .filter((system) => system.type === type)
    .toSorted(byRelease);
}

export function componentsOfKind(kind: Component['kind']): readonly Component[] {
  return getComponents()
    .filter((component) => component.kind === kind)
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export { COMPONENT_KINDS, SYSTEM_FAMILIES };

export interface FamilyGroup<T> {
  readonly id: string;
  readonly label: string;
  readonly members: readonly T[];
}

/**
 * The lineage a machine belongs to, or `undefined` when it belongs to none.
 *
 * Twenty of the machines here are the only one of their kind in the catalog,
 * and for them the honest answer is no navbox at all rather than a box of one.
 */
export function systemFamilyOf(system: System): FamilyGroup<System> | undefined {
  if (system.family === undefined) {
    return undefined;
  }
  const members = getSystems()
    .filter((other) => other.family === system.family)
    .toSorted(byRelease);
  return {
    id: system.family,
    label: systemFamilyLabel(system.family),
    members,
  };
}

/**
 * The lineage a component belongs to.
 *
 * Processors already carry a curated one in `instructionSetFamily`, so they get
 * a navbox for free. Graphics chips and memory carry no lineage in the data,
 * inventing one for them is a curation decision, not a rendering decision, and
 * until it is made their profiles get the breadcrumb and nothing else.
 */
export function componentFamilyOf(component: Component): FamilyGroup<Component> | undefined {
  if (component.kind !== 'cpu' || component.instructionSetFamily === undefined) {
    return undefined;
  }
  const family = component.instructionSetFamily;
  const members = getComponents()
    .filter((other) => other.kind === 'cpu' && other.instructionSetFamily === family)
    .toSorted((a, b) => (a.introducedDate ?? '').localeCompare(b.introducedDate ?? ''));
  return {
    id: family,
    label: `${instructionSetLabel(family)} processors`,
    members,
  };
}

/* -------------------------------------------------------------------------- */
/* What the pages render                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Paths here are site-absolute and unprefixed, the same shape `Crumb.path`
 * carries. The deployment base is applied by whatever renders them, because the
 * JSON-LD builder needs the bare path and the markup needs the prefixed one.
 */
export interface NavItem {
  readonly path: string;
  readonly name: string;
  /** The one line under the name: what it is, and when it arrived. */
  readonly meta: string;
  /** True for the record whose page this is, which renders as text, not a link. */
  readonly current: boolean;
}

export interface FamilyNav {
  readonly label: string;
  readonly items: readonly NavItem[];
  /** Where "see all of them" goes, which is the category the family sits in. */
  readonly category: Crumb;
}

function systemNavItem(system: System, currentId: string): NavItem {
  return {
    path: `/systems/${system.slug}/`,
    name: system.name,
    meta: `${humaniseIdentifier(system.type)} · ${formatPartialDate(system.releaseDate)}`,
    current: system.id === currentId,
  };
}

export function systemCategory(type: SystemType): Crumb {
  return { name: systemTypeLabel(type), path: `/systems/type/${type}/` };
}

export function componentCategory(kind: Component['kind']): Crumb {
  return { name: componentKindLabel(kind), path: `/components/${kind}/` };
}

/** The trail a system profile shows, and the one its JSON-LD describes. */
export function systemCrumbs(system: System): readonly Crumb[] {
  return [
    { name: 'RetroFlops', path: '/' },
    { name: 'Explore', path: '/explore/' },
    systemCategory(system.type),
    { name: system.name, path: `/systems/${system.slug}/` },
  ];
}

export function componentCrumbs(component: Component): readonly Crumb[] {
  return [
    { name: 'RetroFlops', path: '/' },
    { name: 'Explore', path: '/explore/' },
    componentCategory(component.kind),
    { name: component.name, path: `/components/${component.kind}/${component.slug}/` },
  ];
}

export function systemFamilyNav(system: System): FamilyNav | undefined {
  const family = systemFamilyOf(system);
  if (family === undefined) {
    return undefined;
  }
  return {
    label: family.label,
    items: family.members.map((member) => systemNavItem(member, system.id)),
    category: systemCategory(system.type),
  };
}

export function componentFamilyNav(component: Component): FamilyNav | undefined {
  const family = componentFamilyOf(component);
  if (family === undefined) {
    return undefined;
  }
  return {
    label: family.label,
    items: family.members.map((member) => ({
      path: `/components/${member.kind}/${member.slug}/`,
      name: member.name,
      meta:
        member.introducedDate === undefined
          ? member.manufacturer
          : `${member.manufacturer} · ${formatPartialDate(member.introducedDate)}`,
      current: member.id === component.id,
    })),
    category: componentCategory(component.kind),
  };
}

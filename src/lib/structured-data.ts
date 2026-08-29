// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * JSON-LD builders.
 *
 * Structured data describes what a page already shows; it never asserts more.
 * A profile page is `Article` rather than `Product` because the page is an
 * account of a machine with its evidence, not an offer of one, and the
 * catalog is `Dataset` because that is what it is.
 */

import type { Component, Source, System } from './data/schema.ts';
import { sourceCitationUrl } from './data/source-url.ts';

type Node = Record<string, unknown>;

/**
 * Exported because the visible trail renders from the same array this builder
 * serializes. "Structured data describes what a page already shows" only holds
 * if there is one array; two would drift, and the JSON-LD would start asserting
 * a path no reader can walk.
 */
export interface Crumb {
  readonly name: string;
  readonly path: string;
}

/**
 * Breadcrumbs need absolute URLs, so every builder takes a resolver rather than
 * reaching for the site config itself, the same function the pages use for
 * their links, so a base-prefixed deployment stays consistent.
 */
export type AbsoluteUrl = (path: string) => string;

/** Site-wide identity, emitted on the home page. */
export function website(absolute: AbsoluteUrl): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'RetroFlops',
    url: absolute('/'),
  };
}

export function breadcrumbList(crumbs: readonly Crumb[], absolute: AbsoluteUrl): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.path),
    })),
  };
}

/**
 * The lead photograph, as the page publishes it.
 *
 * `license` and `acquireLicensePage` are the point of describing it at all: a
 * photograph this project republishes under somebody else's terms should carry
 * those terms in the machine-readable description too, not only in the caption
 * a person reads.
 */
export interface HeroImageFacts {
  /** Absolute URL of the served variant. */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly caption: string;
  readonly creator: string;
  readonly creatorType: 'person' | 'organization';
  readonly creditText: string;
  readonly licenseUrl: string;
  readonly sourcePageUrl: string;
}

export function imageObject(image: HeroImageFacts): Node {
  return {
    '@type': 'ImageObject',
    contentUrl: image.url,
    url: image.url,
    width: image.width,
    height: image.height,
    caption: image.caption,
    creditText: image.creditText,
    creator: {
      '@type': image.creatorType === 'organization' ? 'Organization' : 'Person',
      name: image.creator,
    },
    license: image.licenseUrl,
    acquireLicensePage: image.sourcePageUrl,
  };
}

export function systemArticle(system: System, absolute: AbsoluteUrl, image?: HeroImageFacts): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: system.name,
    description: system.summary,
    url: absolute(`/systems/${system.slug}/`),
    about: {
      '@type': 'Thing',
      name: system.name,
      description: system.summary,
    },
    ...(image === undefined ? {} : { image: imageObject(image) }),
    isPartOf: catalogDatasetReference(absolute),
  };
}

export function componentArticle(component: Component, absolute: AbsoluteUrl): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: component.name,
    description: component.summary,
    url: absolute(`/components/${component.kind}/${component.slug}/`),
    isPartOf: catalogDatasetReference(absolute),
  };
}

export function sourceArticle(source: Source, absolute: AbsoluteUrl): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: source.title,
    description: `Source record for ${source.title}, published by ${source.publisher}.`,
    url: absolute(`/sources/${source.id}/`),
    citation: sourceCitationUrl(source),
    isPartOf: catalogDatasetReference(absolute),
  };
}

export function methodologyArticle(
  title: string,
  summary: string,
  path: string,
  absolute: AbsoluteUrl,
): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: summary,
    url: absolute(path),
    articleSection: 'Methodology',
  };
}

/**
 * A preset comparison is an `Article` for the same reason a profile is: the page
 * is an argument about the figures, with the figures shown as evidence.
 */
export function comparisonArticle(
  title: string,
  summary: string,
  path: string,
  absolute: AbsoluteUrl,
): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: summary,
    url: absolute(path),
    articleSection: 'Compare',
    isPartOf: catalogDatasetReference(absolute),
  };
}

/** A timeline series page: an account of one quantity over time, with its data. */
export function timelineArticle(
  title: string,
  summary: string,
  path: string,
  absolute: AbsoluteUrl,
): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: summary,
    url: absolute(path),
    articleSection: 'Timeline',
    isPartOf: catalogDatasetReference(absolute),
  };
}

interface DatasetFacts {
  readonly schemaVersion: string;
  readonly measurementCount: number;
  readonly systemCount: number;
  readonly componentCount: number;
}

export function catalogDataset(facts: DatasetFacts, absolute: AbsoluteUrl): Node {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `RetroFlops catalog (${facts.schemaVersion})`,
    description:
      `Sourced performance figures for ${facts.systemCount} computers, consoles, phones and accelerators and ` +
      `${facts.componentCount} of their components. ${facts.measurementCount} figures, each with a source, ` +
      'an exact locator and a confidence status. Metrics are never aggregated into a score, and ratios ' +
      'are valid only within a single comparability group.',
    url: absolute('/data/'),
    version: facts.schemaVersion,
    isAccessibleForFree: true,
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: absolute('/data/catalog-v1.json'),
        name: 'Full catalog',
      },
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: absolute('/data/catalog-summary-v1.json'),
        name: 'Summary index',
      },
      {
        '@type': 'DataDownload',
        encodingFormat: 'text/csv',
        contentUrl: absolute('/data/measurements-v1.csv'),
        name: 'Measurements',
      },
    ],
  };
}

function catalogDatasetReference(absolute: AbsoluteUrl): Node {
  return {
    '@type': 'Dataset',
    name: 'RetroFlops catalog',
    url: absolute('/data/'),
  };
}

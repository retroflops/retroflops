// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Image rights registry for `catalog-v1`.
 *
 * A photograph is not evidence, so it does not face the tier A / two tier B
 * threshold the rest of the catalog faces. What it does face is a question
 * the figures never raise: on what basis may this project republish a modified
 * copy of somebody else's work.
 *
 * There are two such bases and conflating them was the registry's first
 * mistake. A **license** is permission granted by a rights holder on stated
 * conditions, and it has a canonical deed to cite. A work in the **public
 * domain** has no rights to license because the author gave them up or because
 * copyright never attached. There is no deed, only a statement and
 * the authority it rests on. Demanding a deed of both admitted the Creative
 * Commons family and excluded almost every good photograph of a console and
 * every photograph NASA ever took.
 *
 * Both bases are held to exactly the same standard of checkability, which is
 * the whole point of a closed registry:
 *
 * - the entry names a canonical URL where the terms are stated, such as a license
 *   deed, the release wording, or the statute;
 * - the record quotes the statement as the file's own source page words it, and
 *   says where that statement stands;
 * - the record carries a credit line naming the creator, whatever the terms
 *   require. Attribution is this project's rule about citing whose work it
 *   publishes, not only a condition some licenses impose.
 *
 * Still excluded, and deliberately: every `NC` and `ND` variant, because the
 * site is a derivative use; and "no statement at all", which on a photograph
 * means all rights reserved rather than probably fine.
 */

export const IMAGE_RIGHTS_REGISTRY_VERSION = 'image-rights-v1';

/**
 * Why this project may publish the file.
 *
 * Kept as a fact about the entry rather than a detail of its wording, because
 * it is what a reader is actually being told: somebody granted permission, or
 * nobody holds the rights to grant.
 */
export const RIGHTS_BASES = ['license', 'public-domain'] as const;

export type RightsBasis = (typeof RIGHTS_BASES)[number];

export interface ImageRights {
  readonly id: string;
  readonly label: string;
  readonly basis: RightsBasis;
  /** Canonical statement of the terms: a license deed, the release wording, or the statute. */
  readonly url: string;
  /**
   * Whether the terms themselves oblige us to name the creator. Recorded
   * because it is worth showing, and never used to decide whether to credit:
   * every image record carries a credit line regardless.
   */
  readonly requiresAttribution: boolean;
  /** Whether a derivative, such as a resized and re-encoded copy, inherits the terms. */
  readonly shareAlike: boolean;
}

export const IMAGE_RIGHTS: readonly ImageRights[] = [
  {
    id: 'public-domain-mark-1.0',
    label: 'Public Domain Mark 1.0',
    basis: 'public-domain',
    url: 'https://creativecommons.org/publicdomain/mark/1.0/',
    requiresAttribution: false,
    shareAlike: false,
  },
  {
    id: 'cc0-1.0',
    label: 'CC0 1.0 Universal',
    basis: 'public-domain',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    requiresAttribution: false,
    shareAlike: false,
  },
  {
    /**
     * The author's own release, as Wikimedia Commons publishes its wording:
     * the work is put into the public domain worldwide, with a fallback grant
     * of unconditional use where a jurisdiction will not permit that.
     *
     * The template page is the canonical URL because it is where the wording
     * this project is relying on is actually published. A file page quotes it;
     * it does not define it.
     */
    id: 'pd-self',
    label: 'Public domain (released by its author)',
    basis: 'public-domain',
    url: 'https://commons.wikimedia.org/wiki/Template:PD-self',
    requiresAttribution: false,
    shareAlike: false,
  },
  {
    /**
     * Works of the United States federal government, which 17 U.S.C. §105
     * places outside copyright protection altogether. This is what carries the
     * Apollo and Saturn photography: NASA did not license those pictures,
     * because there was never a copyright in them to license.
     */
    id: 'pd-us-government',
    label: 'Public domain (work of the US federal government)',
    basis: 'public-domain',
    url: 'https://www.copyright.gov/title17/92chap1.html',
    requiresAttribution: false,
    shareAlike: false,
  },
  {
    id: 'cc-by-2.0',
    label: 'CC BY 2.0',
    basis: 'license',
    url: 'https://creativecommons.org/licenses/by/2.0/',
    requiresAttribution: true,
    shareAlike: false,
  },
  {
    id: 'cc-by-3.0',
    label: 'CC BY 3.0',
    basis: 'license',
    url: 'https://creativecommons.org/licenses/by/3.0/',
    requiresAttribution: true,
    shareAlike: false,
  },
  {
    id: 'cc-by-4.0',
    label: 'CC BY 4.0',
    basis: 'license',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    requiresAttribution: true,
    shareAlike: false,
  },
  {
    id: 'cc-by-sa-2.0',
    label: 'CC BY-SA 2.0',
    basis: 'license',
    url: 'https://creativecommons.org/licenses/by-sa/2.0/',
    requiresAttribution: true,
    shareAlike: true,
  },
  {
    id: 'cc-by-sa-3.0',
    label: 'CC BY-SA 3.0',
    basis: 'license',
    url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    requiresAttribution: true,
    shareAlike: true,
  },
  {
    id: 'cc-by-sa-4.0',
    label: 'CC BY-SA 4.0',
    basis: 'license',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    requiresAttribution: true,
    shareAlike: true,
  },
] as const;

export const IMAGE_RIGHTS_IDS = IMAGE_RIGHTS.map((rights) => rights.id) as [string, ...string[]];

export function getImageRights(id: string): ImageRights | undefined {
  return IMAGE_RIGHTS.find((rights) => rights.id === id);
}

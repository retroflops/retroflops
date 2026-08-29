// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * `catalog-v1`, the versioned public data model.
 *
 * Systems, components and the figures attached to them are separate records
 * joined by identifier. Numbers are carried as exact decimal strings so that
 * source precision survives normalization, and an absent figure is an explicit
 * `unknown` or `not-applicable` state rather than a zero.
 *
 * These schemas describe the shape of a record. Separate validation enforces
 * cross-record integrity, including dangling references, duplicate figures and source sufficiency.
 * `data:validate`.
 */

import { z } from 'zod';

import { deriveComparabilityGroup } from './comparability.ts';
import {
  CANONICAL_FORMAT,
  CANONICAL_HEIGHT,
  CANONICAL_WIDTH,
  IMAGE_FIT_MODES,
  IMAGE_PRESET_ID,
} from './image-preset.ts';
import { IMAGE_RIGHTS_IDS } from './image-rights.ts';
import { EVIDENCE_STAGES, METHOD_IDS, PROVENANCES } from './methods.ts';
import {
  CONFIDENCE_STATUSES,
  EDITORIAL_STATUSES,
  EVIDENCE_LEVELS,
  MEASUREMENT_SCOPES,
  METRIC_IDS,
  VALUE_ABSENCES,
} from './metrics.ts';
import { isNormalizationCurrent } from './normalize.ts';
import { UNIT_IDS } from './units.ts';

export const CATALOG_SCHEMA_VERSION = 'catalog-v1';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase kebab-case slug');

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:[-:][a-z0-9]+)*$/, 'must be a lowercase identifier');

/** An exact decimal literal. Kept as a string; never parsed into a JS number. */
const decimalString = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/, 'must be an exact decimal literal');

/** Full or partial ISO date: `1969`, `1969-07`, `1969-07-16`. */
const partialDate = z
  .string()
  .regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/, 'must be YYYY, YYYY-MM or YYYY-MM-DD');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'must be a lowercase SHA-256 hex digest');

const unitId = z.enum(UNIT_IDS);
const metricId = z.enum(METRIC_IDS);
const methodId = z.enum(METHOD_IDS);
const provenance = z.enum(PROVENANCES);
const evidenceStage = z.enum(EVIDENCE_STAGES);
const measurementScope = z.enum(MEASUREMENT_SCOPES);
const confidenceStatus = z.enum(CONFIDENCE_STATUSES);
const evidenceLevel = z.enum(EVIDENCE_LEVELS);
const editorialStatus = z.enum(EDITORIAL_STATUSES);

export const UNKNOWN_RESEARCH_ROUTES = [
  'vendor-documentation',
  'independent-analysis',
  'specialist-reference',
  'benchmark-database',
  'archive',
  'community-source',
] as const;

const unknownAuditSchema = z.object({
  reviewedOn: isoDate,
  routesChecked: z.array(z.enum(UNKNOWN_RESEARCH_ROUTES)).min(2),
  outcome: z.enum(['no-published-candidate', 'no-compatible-candidate']),
  summary: z.string().min(1),
});

/**
 * A quantity that may legitimately be missing. Absence is a first-class state so
 * that "we do not know" and "this machine has no GPU" never collapse into zero.
 */
export const statedQuantitySchema = z.object({
  state: z.literal('value'),
  value: decimalString,
  unit: unitId,
  /** Significant digits carried by the source. */
  significantDigits: z.int().min(1).max(21),
});

export const quantitySchema = z.discriminatedUnion('state', [
  statedQuantitySchema,
  z.object({
    state: z.enum(VALUE_ABSENCES),
    note: z.string().min(1).optional(),
  }),
]);

export type QuantityValue = z.infer<typeof quantitySchema>;

/* -------------------------------------------------------------------------- */
/* Source                                                                      */
/* -------------------------------------------------------------------------- */

export const SOURCE_TIERS = ['A', 'B', 'C'] as const;
const SOURCE_URL_STATUSES = ['known-unavailable'] as const;

export const SOURCE_TYPES = [
  'vendor-documentation',
  'government-document',
  'technical-manual',
  'official-benchmark-result',
  'independent-analysis',
  'book',
  'periodical',
  'wiki',
  'aggregator',
] as const;

/** Provenance of one `data:fetch` run against a source URL. */
export const fetchProvenanceSchema = z.object({
  url: z.url(),
  /** Present only when a redirect moved the request off the requested URL. */
  finalUrl: z.url().optional(),
  fetchedAt: z.iso.datetime(),
  httpStatus: z.int().min(100).max(599),
  contentType: z.string().min(1).optional(),
  byteLength: z.int().min(0),
  sha256,
});

export const sourceSchema = z
  .object({
    id: identifier,
    title: z.string().min(1),
    publisher: z.string().min(1),
    author: z.string().min(1).optional(),
    url: z.url().optional(),
    /** The original address is retained, but an archive copy becomes the citation. */
    urlStatus: z.enum(SOURCE_URL_STATUSES).optional(),
    /** Mirror or Wayback capture, required whenever `url` is not permanently hosted. */
    archiveUrl: z.url().optional(),
    publishedDate: partialDate.optional(),
    accessedDate: isoDate,
    /**
     * Where inside the source the figure lives: page, table, section or timecode.
     * Free text because sources are heterogeneous, but never empty.
     */
    locator: z.string().min(1),
    /** Short verbatim extract kept for provenance, especially for PDFs and scans. */
    extract: z.string().min(1).max(600).optional(),
    /** SHA-256 of the fetched artifact or of the manually transcribed extract. */
    extractHash: sha256.optional(),
    tier: z.enum(SOURCE_TIERS),
    sourceType: z.enum(SOURCE_TYPES),
    license: z.string().min(1).optional(),
    /** Usage restrictions that must be surfaced next to any quotation, e.g. SPEC fair use. */
    usageNote: z.string().min(1).optional(),
    /**
     * Approved sources are frozen against `data:fetch`: an upstream change is
     * reported for review instead of being written into the manifest.
     */
    editorialStatus: editorialStatus.default('provisional'),
    /** Adapter that reads this source's structured content, if it has one. */
    adapter: identifier.optional(),
    /** Written by `data:fetch`; evidence of what was retrieved, never a fact. */
    fetch: fetchProvenanceSchema.optional(),
  })
  .refine(
    (source) =>
      source.urlStatus !== 'known-unavailable' ||
      (source.url !== undefined && source.archiveUrl !== undefined),
    {
      message: 'a known-unavailable URL needs both the original URL and an archive URL',
      path: ['urlStatus'],
    },
  );

export type Source = z.infer<typeof sourceSchema>;

/* -------------------------------------------------------------------------- */
/* Research record                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A hand-made record for sources no adapter can read: PDFs, scans, printed
 * manuals, photographs of a nameplate.
 *
 * It exists so that a figure taken from a document is still traceable to an
 * exact position and an exact quotation. The extract is deliberately short,
 * enough to verify the figure rather than republish the source. Its hash
 * is checked, so a corrupted or edited transcription is caught rather than
 * quietly trusted.
 */
export const researchRecordSchema = z.object({
  id: identifier,
  sourceId: identifier,
  /** Exact position: page, figure, table, plate or timecode. */
  locator: z.string().min(1),
  /** Verbatim quotation containing the figure. Kept short on purpose. */
  extract: z.string().min(1).max(600),
  /** SHA-256 of `extract`, verified during validation. */
  extractHash: sha256,
  /** What the transcriber read the extract as saying, before any conversion. */
  transcribed: quantitySchema.optional(),
  transcribedOn: isoDate,
  /** Who made the transcription, so a questionable reading has an owner. */
  transcribedBy: z.string().min(1),
  /** Anything ambiguous in the source: smudged digits, unclear units, footnotes. */
  notes: z.string().min(1).optional(),
});

export type ResearchRecord = z.infer<typeof researchRecordSchema>;

/* -------------------------------------------------------------------------- */
/* Image asset                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How an original of some other shape was brought to 4:3.
 *
 * Written down rather than inferred, because the alternative to writing it down
 * is a photograph nobody can account for: a console that looks slightly too
 * narrow, or a card whose end has been quietly cut off. The recipe is versioned
 * with the preset, so re-running the normalization on the same original must
 * reproduce the same bytes, which is what makes the stored hash meaningful.
 */
export const imageTransformSchema = z.object({
  preset: z.literal(IMAGE_PRESET_ID),
  /** Pixel size of the fetched original, as the recipe was planned against it. */
  sourceWidth: z.int().min(1),
  sourceHeight: z.int().min(1),
  fit: z.enum(IMAGE_FIT_MODES),
  /** The rectangle taken out of the original. Only for `crop`, and itself 4:3. */
  region: z
    .object({
      x: z.int().min(0),
      y: z.int().min(0),
      width: z.int().min(1),
      height: z.int().min(1),
    })
    .optional(),
  /** The color a margin is filled with. Only for `pad`. */
  background: z
    .string()
    .regex(/^#[0-9a-f]{6}$/, 'must be a lowercase six-digit hex color')
    .optional(),
  /** Why this recipe was chosen, including what changed and why. */
  note: z.string().min(1),
});

export type ImageTransform = z.infer<typeof imageTransformSchema>;

/**
 * A photograph of a machine, and the right to publish it.
 *
 * An image is not evidence. No figure in this catalog rests on one, which is
 * why an image record faces none of the source-tier arithmetic a measurement
 * faces, and why it faces something the measurements do not: a license that
 * permits this project to redistribute a modified copy, attached
 * unambiguously to this file rather than to the site that hosts it.
 *
 * Images belong to systems only. A `Component` record describes a chip, and a
 * photograph of a chip is a different editorial undertaking from a photograph
 * of the machine a reader recognizes; the model refuses it outright rather than
 * leaving the door open for a graphics card's photograph to end up on the
 * silicon inside it.
 */
export const imageAssetSchema = z.object({
  id: identifier,
  /**
   * What the photograph shows, for a reader who cannot see it. Not a caption
   * and not a title: it is the picture, in words.
   */
  alt: z.string().min(1).max(300),
  /** The editorial line printed under the figure. */
  caption: z.string().min(1),
  /** Who made the photograph, spelled as the license requires it to be spelled. */
  creator: z.string().min(1),
  /**
   * Whether that name is a person or an institution. Recorded because the
   * structured description has to say which, and a museum described as a person
   * is a small false statement made in machine-readable form.
   */
  creatorType: z.enum(['person', 'organization']),
  /** The file's own title at the source, so a reader can find it again. */
  title: z.string().min(1),
  /** Who publishes the file, the repository or archive, not the photographer. */
  publisher: z.string().min(1),
  /** The page that describes the file and states its license. */
  sourcePageUrl: z.url(),
  /** The original bytes themselves; the only address `data:fetch` will request. */
  originalUrl: z.url(),
  accessedDate: isoDate,
  /**
   * The complete credit line, shown wherever the image is. Required whatever
   * the terms demand: crediting whose work this is, is a rule of this project
   * rather than a condition some licenses impose and others do not.
   */
  attribution: z.string().min(1),
  /**
   * On what basis this project may publish the file: a license, or a public
   * domain status. Both come from the closed rights registry and both are held
   * to the same standard, a canonical URL for the terms, and the statement as
   * this particular file's page words it.
   */
  rights: z.object({
    id: z.enum(IMAGE_RIGHTS_IDS),
    /** The canonical terms. Checked against the registry, not merely present. */
    url: z.url(),
    /**
     * The wording as the source page states it *for this file*.
     *
     * A site-wide notice in a footer licenses a website, not a photograph on
     * it, and the difference is the whole question of whether this project may
     * republish the picture. Quoting the statement is how that difference stays
     * visible to a reviewer, and for a public domain release it is the only
     * evidence there is, since there is no deed behind it.
     */
    statement: z.string().min(1).max(400),
    /** Where the statement above appears. Must be the file's own source page. */
    statedAt: z.url(),
  }),
  /** The fetched original, frozen by hash exactly as a document source is. */
  original: z.object({
    sha256,
    byteLength: z.int().min(1),
    width: z.int().min(1),
    height: z.int().min(1),
    mediaType: z.string().min(1),
  }),
  /** The file this repository stores and the site publishes. */
  canonical: z.object({
    format: z.literal(CANONICAL_FORMAT),
    width: z.literal(CANONICAL_WIDTH),
    height: z.literal(CANONICAL_HEIGHT),
    byteLength: z.int().min(1),
    sha256,
  }),
  transform: imageTransformSchema,
  editorialStatus,
  notes: z.string().min(1).optional(),
});

export type ImageAsset = z.infer<typeof imageAssetSchema>;

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export const COMPONENT_KINDS = ['cpu', 'gpu', 'memory'] as const;

/**
 * Instruction set lineages present in the catalog. Deliberately coarse, the
 * point is to answer "show me the MIPS machines", not to distinguish MIPS I
 * from MIPS IV, which `instructionSet` already records in the source's own
 * words. Adding a family is an editorial decision about kinship, so the list
 * grows only when a record genuinely belongs to one.
 */
export const INSTRUCTION_SET_FAMILIES = [
  'mos-6502',
  'motorola-68000',
  'mips',
  'superh',
  'power',
  'x86',
  'arm',
] as const;

export type InstructionSetFamily = (typeof INSTRUCTION_SET_FAMILIES)[number];

const componentBase = {
  id: identifier,
  slug,
  name: z.string().min(1),
  /** Editorial names readers may use to find this record in selectors. */
  aliases: z.array(z.string().min(1)).optional(),
  manufacturer: z.string().min(1),
  architecture: z.string().min(1).optional(),
  introducedDate: partialDate.optional(),
  summary: z.string().min(1),
  sourceIds: z.array(identifier).min(1),
  editorialStatus,
  notes: z.string().min(1).optional(),
  /**
   * Present only to be refused. A component is a chip, and the photographs this
   * catalog publishes are of machines; without an explicit refusal the field
   * would be dropped in silence and a curator would think they had illustrated
   * the 6510 when they had illustrated nothing at all.
   */
  imageIds: z
    .never({ error: 'images belong to systems; a component record cannot reference one' })
    .optional(),
};

export const componentSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...componentBase,
      kind: z.literal('cpu'),
      instructionSet: z.string().min(1).optional(),
      /**
       * Controlled counterpart to `instructionSet`, which is free prose and
       * therefore close to unique per record. A family groups processors that
       * genuinely share an instruction set lineage, which is the one architectural
       * question a reader can usefully filter by.
       *
       * Optional because not every processor belongs to a family: the Apollo
       * Guidance Computer and the Saturn LVDC each have an instruction set built
       * for one machine, and putting them in a bucket would imply kinship that
       * does not exist.
       */
      instructionSetFamily: z.enum(INSTRUCTION_SET_FAMILIES).optional(),
    })
    .strict(),
  z
    .object({
      ...componentBase,
      kind: z.literal('gpu'),
      apiSupport: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      ...componentBase,
      kind: z.literal('memory'),
      memoryType: z.string().min(1).optional(),
    })
    .strict(),
]);

export type Component = z.infer<typeof componentSchema>;

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

export const COMPONENT_ROLES = [
  'main-cpu',
  'co-processor',
  'sound-cpu',
  'gpu',
  'system-memory',
  'video-memory',
  'unified-memory',
  'cache',
  /**
   * Mass storage fitted to the machine. A separate role rather than a kind of
   * memory, because a flash chip a program is loaded *from* and a memory a
   * program runs *in* are two quantities, and a machine that confuses them
   * reports a phone with four gigabytes of memory in 2007.
   */
  'storage',
] as const;

export type ComponentRole = (typeof COMPONENT_ROLES)[number];

/** One component fitted in a system variant. */
export const configurationEntrySchema = z
  .object({
    componentId: identifier,
    role: z.enum(COMPONENT_ROLES),
    /** How many of this component the variant contains. */
    count: z.int().min(1),
    /** Figures shown for this fitted part, in editorial order. */
    measurementIds: z.array(identifier).default([]),
    /** True when the capacity is shared with another role, e.g. unified memory. */
    shared: z.boolean().default(false),
    notes: z.string().min(1).optional(),
  })
  .strict();

export type ConfigurationEntry = z.infer<typeof configurationEntrySchema>;

/** A regional or hardware variant of a system. */
export const configurationSchema = z.object({
  id: identifier,
  label: z.string().min(1),
  region: z.string().min(1).optional(),
  releaseDate: partialDate.optional(),
  entries: z.array(configurationEntrySchema).min(1),
  notes: z.string().min(1).optional(),
});

export type Configuration = z.infer<typeof configurationSchema>;

/* -------------------------------------------------------------------------- */
/* System                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What kind of machine a record is.
 *
 * `handheld` means a portable games console, so a telephone cannot be filed
 * under it: the two share a form factor and nothing else, and the bucket would
 * assert a kinship that does not exist. `smartphone` is therefore its own type
 * rather than a shade of an existing one.
 */
export const SYSTEM_TYPES = [
  'guidance-computer',
  'mainframe',
  'minicomputer',
  'workstation',
  'home-computer',
  'personal-computer',
  'console',
  'handheld',
  'smartphone',
  'accelerator',
] as const;

export type SystemType = (typeof SYSTEM_TYPES)[number];

/**
 * Product lineages present in the catalog.
 *
 * A family answers "what else is this machine one of", which is the question
 * `manufacturer` looks like it should answer and cannot. The firm's name is not
 * the lineage: the PlayStation 5 is made by Sony Interactive Entertainment and
 * the four before it by Sony Computer Entertainment, and the Amiga 500 by
 * Commodore-Amiga while the Amiga 1200 by Commodore Business Machines. Deriving
 * kinship from those strings would split exactly the two lineages a reader is
 * most likely to be looking for, so kinship is curated instead, on the same
 * terms as `instructionSetFamily`.
 *
 * Two rules keep the list from becoming a second, sloppier `type`, and
 * `data:validate` enforces both:
 *
 * - A family never crosses `type`. Nintendo's home consoles and its handhelds
 *   are two families, because a navbox that mixed them would contradict the
 *   category named in the breadcrumb directly above it.
 * - A family has at least two members. A lineage of one is a category that has
 *   been misfiled, and a navbox listing only the page you are standing on is
 *   noise.
 *
 * Belonging to none is the ordinary case, not a gap: the Apollo Guidance
 * Computer, the Saturn LVDC, the SGI Octane, the 3dfx Voodoo and most of the
 * eight-bit home computers are each the only one of their kind here, and
 * inventing a bucket for them would assert a kinship that does not exist.
 */
export const SYSTEM_FAMILIES = [
  'apple-iphone',
  'apple-macintosh',
  'commodore-amiga',
  'microsoft-xbox',
  'nintendo-handheld',
  'nintendo-home-console',
  'nvidia-geforce',
  'radeon',
  'reference-pc',
  'sega-console',
  'sony-playstation',
] as const;

export type SystemFamily = (typeof SYSTEM_FAMILIES)[number];

export const systemSchema = z.object({
  id: identifier,
  slug,
  name: z.string().min(1),
  /** Editorial names readers may use to find this record in selectors. */
  aliases: z.array(z.string().min(1)).optional(),
  manufacturer: z.string().min(1),
  type: z.enum(SYSTEM_TYPES),
  /** The product lineage this machine belongs to, where it belongs to one. */
  family: z.enum(SYSTEM_FAMILIES).optional(),
  releaseDate: partialDate,
  /** Primary launch region; per-variant regions live on the configuration. */
  region: z.string().min(1).optional(),
  summary: z.string().min(1),
  description: z.string().min(1).optional(),
  configurations: z.array(configurationSchema).min(1),
  /**
   * Photographs of this machine, in editorial order. The first is the lead
   * image and the only one anything currently renders; the rest are kept in
   * order so that a gallery can be added later without a data migration, which
   * is the one thing a single-image field would have made impossible.
   */
  imageIds: z.array(identifier).min(1).optional(),
  sourceIds: z.array(identifier).min(1),
  editorialStatus,
  notes: z.string().min(1).optional(),
});

export type System = z.infer<typeof systemSchema>;

/* -------------------------------------------------------------------------- */
/* Measurement                                                                 */
/* -------------------------------------------------------------------------- */

export const subjectRefSchema = z.object({
  kind: z.enum(['system', 'component']),
  id: identifier,
  /** Narrows the figure to one variant of a system. */
  configurationId: identifier.optional(),
  /**
   * Which part of the subject the figure describes, for a record holding several
   * that answer one question differently: the four performance cores of an Apple
   * M1 against its four efficiency cores.
   *
   * Deliberately outside the comparability group. A clock is a clock whichever
   * cores hold it, and putting the part in the group would move the M1 out of
   * the row every other machine's clock sits in, the exact failure this model
   * was repaired to prevent. It is part of the *slot* a figure occupies instead,
   * so two parts are two figures rather than a conflict between them.
   */
  part: identifier.optional(),
});

export type SubjectRef = z.infer<typeof subjectRefSchema>;

export const benchmarkIdentitySchema = z.object({
  id: identifier,
  version: z.string().min(1),
  variant: z.string().min(1).optional(),
});

export const ROUNDING_RULES = ['half-up', 'half-even', 'truncate', 'none'] as const;

/**
 * Derived twin of a stated quantity, expressed in the quantity's base unit.
 * Written by `data:normalize` and re-derived on every validation run.
 */
export const normalizedQuantitySchema = z.object({
  value: decimalString,
  unit: unitId,
  significantDigits: z.int().min(1).max(21),
  unitRegistry: z.string().min(1),
});

export const measurementSchema = z
  .object({
    id: identifier,
    subject: subjectRefSchema,
    metric: metricId,
    quantity: quantitySchema,
    normalized: normalizedQuantitySchema.optional(),
    scope: measurementScope,
    /** How the figure was produced, from the closed `methods-v1` registry. */
    method: methodId,
    /**
     * Who stated the figure. Recorded because it is what a reader wants to know,
     * and kept out of the comparability group because a vendor's silence must not
     * cut its hardware off from every figure somebody else published.
     */
    provenance,
    /**
     * Whether the figure describes hardware that reached buyers or an
     * announcement made before it did. A `pre-launch` figure must stay
     * `provisional`, which is what keeps it out of automatic multipliers.
     */
    evidenceStage,
    benchmark: benchmarkIdentitySchema.optional(),
    /**
     * The day a moving figure was read, for a figure that moves.
     *
     * A benchmark publisher's chart average is recomputed as results arrive, so
     * it is true of a day and of no other day. Recording it without saying which
     * day would put a number in the catalog that quietly stops being the one
     * the citation supports, and would make the build's output depend on when
     * it ran. Required by validation for every method that produces a rolling
     * quantity.
     */
    asOf: isoDate.optional(),
    /** Conditions that materially affect the figure: clock, cooling, compiler, workload. */
    conditions: z.string().min(1).optional(),
    /** Canonical group id; re-derived and checked below. */
    comparabilityGroup: z.string().min(1),
    rounding: z.enum(ROUNDING_RULES).default('none'),
    status: confidenceStatus,
    /** Strength of the sources for a stated number. Required only for values. */
    evidenceLevel: evidenceLevel.optional(),
    /**
     * The derived claim this figure carries, for a number this project computed
     * rather than read. The claim holds the formula, the input records and the
     * exclusions; validation recomputes it and requires this figure to match, so
     * a computed total can never drift from its terms.
     */
    derivedFrom: identifier.optional(),
    editorialStatus,
    sourceIds: z.array(identifier).min(1),
    /**
     * Research records carrying the verbatim extract this figure was read from.
     * Required for figures taken from documents no adapter can read, so a reader
     * can go from the number to the exact sentence rather than to the document.
     */
    extractIds: z.array(identifier).optional(),
    /** Caveats shown next to the figure wherever it appears. */
    caveat: z.string().min(1).optional(),
    /** What was checked before the catalog concluded that a quantity is unknown. */
    unknownAudit: unknownAuditSchema.optional(),
  })
  .superRefine((measurement, ctx) => {
    // The group comes from metric, scope, method and benchmark, never the unit.
    // Validation can therefore check it even when the figure itself is absent.
    const expected = deriveComparabilityGroup({
      metric: measurement.metric,
      scope: measurement.scope,
      method: measurement.method,
      benchmark: measurement.benchmark,
    });
    if (measurement.comparabilityGroup !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['comparabilityGroup'],
        message: `comparability group must be "${expected}" for this metric, scope, method and benchmark`,
      });
    }

    // Announced figures are protected by staying provisional rather than by
    // sitting in a comparability group of their own: `provisional` already
    // blocks every automatic multiplier, while a separate group would only push
    // the announcement into a row of its own where it explains nothing.
    if (
      measurement.evidenceStage === 'pre-launch' &&
      measurement.editorialStatus !== 'provisional'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['editorialStatus'],
        message:
          'a pre-launch figure must stay provisional until shipped hardware is documented to carry it',
      });
    }

    // `derived` means this project computed the figure through a versioned
    // formula, which is exactly what a derived claim is. One without the other
    // is either an uncheckable number or an unused computation.
    if ((measurement.status === 'derived') !== (measurement.derivedFrom !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['derivedFrom'],
        message:
          'a figure with status "derived" must name the derived claim it carries, and only such a figure may',
      });
    }

    // `unverified` says nobody here has read the cited page. A note would be a
    // claim about a document this record admits to not having opened, and that
    // is precisely the contradiction the state exists to end, several records
    // once asserted "the manual does not state a standalone clock" beside a
    // caveat conceding the manual was never transcribed. The state alone is the
    // whole of what may be said, and it stays provisional until someone reads it.
    if (measurement.quantity.state === 'unverified') {
      if (measurement.quantity.note !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['quantity', 'note'],
          message:
            'an unverified figure may not describe what its unread source contains; state the gap by leaving the note off',
        });
      }
      if (measurement.editorialStatus !== 'provisional') {
        ctx.addIssue({
          code: 'custom',
          path: ['editorialStatus'],
          message: 'an unverified figure must stay provisional until its source has been read',
        });
      }
    }

    if (measurement.quantity.state === 'value') {
      if (measurement.evidenceLevel === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidenceLevel'],
          message: 'a stated value must declare its evidence level',
        });
      }
      if (measurement.unknownAudit !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['unknownAudit'],
          message: 'a stated value may not carry an unknown audit',
        });
      }
    } else if (measurement.evidenceLevel !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceLevel'],
        message: 'an absent quantity may not declare an evidence level',
      });
    }

    if (measurement.quantity.state === 'unknown') {
      const routes = measurement.unknownAudit?.routesChecked ?? [];
      if (
        measurement.unknownAudit !== undefined &&
        !routes.some((route) => route !== 'vendor-documentation')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['unknownAudit', 'routesChecked'],
          message: 'an unknown audit must include a route beyond vendor documentation',
        });
      }
    } else if (measurement.unknownAudit !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['unknownAudit'],
        message: 'only an unknown quantity may carry an unknown audit',
      });
    }

    if (measurement.quantity.state !== 'value') {
      return;
    }
    if (
      measurement.normalized !== undefined &&
      !isNormalizationCurrent(measurement.quantity, measurement.normalized)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['normalized'],
        message: 'normalized value is stale or hand-edited; re-run data:normalize to regenerate it',
      });
    }
  });

export type Measurement = z.infer<typeof measurementSchema>;

/* -------------------------------------------------------------------------- */
/* Context claim                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A sourced numerical fact used in narrative or profile context, but not a
 * metric. Context claims deliberately carry no method or comparability group:
 * they can be rendered and cited, but can never enter charts, multipliers or
 * derived formulas.
 */
export const contextClaimSchema = z
  .object({
    id: identifier,
    subject: subjectRefSchema,
    label: z.string().min(1),
    quantity: statedQuantitySchema,
    provenance,
    evidenceStage,
    status: confidenceStatus,
    evidenceLevel,
    editorialStatus,
    sourceIds: z.array(identifier).min(1),
    extractIds: z.array(identifier).optional(),
    caveat: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((claim, ctx) => {
    if (claim.status === 'derived') {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'a context claim is stated evidence, not a derived figure',
      });
    }
    if (claim.evidenceStage === 'pre-launch' && claim.editorialStatus !== 'provisional') {
      ctx.addIssue({
        code: 'custom',
        path: ['editorialStatus'],
        message: 'a pre-launch claim must stay provisional until shipped hardware is documented',
      });
    }
  });

export type ContextClaim = z.infer<typeof contextClaimSchema>;

/* -------------------------------------------------------------------------- */
/* Derived claim                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A number computed from other numbers, a ratio, a words-to-bytes conversion, a
 * per-watt figure. The formula is versioned and the inputs are named so the
 * result can always be recomputed and audited.
 */
export const derivedClaimSchema = z.object({
  id: identifier,
  formula: z.object({
    id: identifier,
    version: z.string().min(1),
    /** Human-readable expression shown next to the result. */
    expression: z.string().min(1),
  }),
  inputMeasurementIds: z.array(identifier).min(1),
  /**
   * Figures deliberately left out of the computation.
   *
   * A total is only as trustworthy as the decision about what belongs in it, so
   * the exclusions are named records with a written reason rather than a
   * sentence in the caveat, the generated caveat is built from them.
   */
  exclusions: z
    .array(
      z.object({
        measurementId: identifier,
        label: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .optional(),
  /**
   * Numbers a formula needs that are not a measurement of anything.
   *
   * How many lanes a graphics processor issues from, and how many floating-point
   * operations one lane retires per clock, are facts about an architecture
   * rather than figures somebody published about a machine, no subject in the
   * catalog states them, so they cannot be input measurements. They are also
   * exactly where a derivation goes wrong quietly, which is why each one carries
   * its own sources and its own written reason and is named in the result's
   * caveat: a constant nobody can check is an assumption pretending to be
   * arithmetic.
   */
  constants: z
    .array(
      z.object({
        id: identifier,
        label: z.string().min(1),
        value: decimalString,
        reason: z.string().min(1),
        sourceIds: z.array(identifier).min(1),
      }),
    )
    .optional(),
  result: quantitySchema,
  rounding: z.enum(ROUNDING_RULES),
  /** Generated automatically from the inputs; always displayed with the result. */
  caveat: z.string().min(1),
  editorialStatus,
});

export type DerivedClaim = z.infer<typeof derivedClaimSchema>;

/* -------------------------------------------------------------------------- */
/* Conflict                                                                    */
/* -------------------------------------------------------------------------- */

/** Competing figures for the same subject and metric, plus the editorial decision. */
export const conflictSchema = z.object({
  id: identifier,
  subject: subjectRefSchema,
  metric: metricId,
  candidates: z
    .array(
      z.object({
        quantity: quantitySchema,
        sourceIds: z.array(identifier).min(1),
        evidence: z.string().min(1),
      }),
    )
    .min(2),
  decision: z.discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('accepted'),
      /** Index into `candidates`. */
      candidateIndex: z.int().min(0),
      rationale: z.string().min(1),
      decidedOn: isoDate,
    }),
    z.object({
      outcome: z.literal('unresolved'),
      rationale: z.string().min(1),
      decidedOn: isoDate,
    }),
  ]),
});

export type Conflict = z.infer<typeof conflictSchema>;

/* -------------------------------------------------------------------------- */
/* Catalog                                                                     */
/* -------------------------------------------------------------------------- */

export const catalogSchema = z.object({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  /** Registry versions the artifact was built against. */
  registries: z.object({
    units: z.string().min(1),
    metrics: z.string().min(1),
    methods: z.string().min(1),
    comparability: z.string().min(1),
    formulas: z.string().min(1),
    imageRights: z.string().min(1),
  }),
  systems: z.array(systemSchema),
  components: z.array(componentSchema),
  images: z.array(imageAssetSchema),
  measurements: z.array(measurementSchema),
  contextClaims: z.array(contextClaimSchema),
  sources: z.array(sourceSchema),
  derivedClaims: z.array(derivedClaimSchema),
  conflicts: z.array(conflictSchema),
});

export type Catalog = z.infer<typeof catalogSchema>;

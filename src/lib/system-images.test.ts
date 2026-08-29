// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * The photographs the catalog actually publishes, checked against the
 * catalog rather than against a fixture.
 *
 * `data:validate` already refuses a record whose file is missing or altered.
 * What it cannot see is the join the site depends on: that the first id in a
 * system's list resolves to a record and to a file the build can process.
 */

import { describe, expect, it } from 'vitest';

import { getCatalog } from './catalog.ts';
import { getImageById, getLeadImage } from './system-images.ts';

const catalog = getCatalog();

/** The machines this increment illustrates. Growing this list is an editorial act. */
const ILLUSTRATED: Readonly<Record<string, string>> = {
  'commodore-64': 'commodore-64-computer',
  'sony-playstation': 'sony-playstation-scph-1000',
  'nvidia-geforce-gtx-1080': 'nvidia-geforce-gtx-1080-cards',
  // The consoles, in release order, all twenty-three of them. The Series X and
  // the PlayStation 5 came last, after a first sweep looked in the parent
  // categories only and threw away every portrait file: both machines are tall
  // boxes, so every photograph of them is portrait and the recipe pads.
  'atari-2600': 'atari-2600-console',
  'nintendo-entertainment-system': 'nintendo-entertainment-system-console',
  'sega-master-system': 'sega-master-system-console',
  'nec-pc-engine': 'nec-pc-engine-console',
  'sega-mega-drive': 'sega-mega-drive-console',
  'snk-neo-geo-aes': 'snk-neo-geo-aes-console',
  'super-nintendo': 'super-nintendo-console',
  'sega-saturn': 'sega-saturn-console',
  'nintendo-64': 'nintendo-64-console',
  'sega-dreamcast': 'sega-dreamcast-console',
  'sony-playstation-2': 'sony-playstation-2-console',
  'nintendo-gamecube': 'nintendo-gamecube-console',
  'microsoft-xbox': 'microsoft-xbox-console',
  'microsoft-xbox-360': 'microsoft-xbox-360-console',
  'nintendo-wii': 'nintendo-wii-console',
  'sony-playstation-3': 'sony-playstation-3-console',
  'nintendo-wii-u': 'nintendo-wii-u-console',
  'microsoft-xbox-one': 'microsoft-xbox-one-console',
  'sony-playstation-4': 'sony-playstation-4-console',
  'nintendo-switch': 'nintendo-switch-console',
  'nintendo-switch-2': 'nintendo-switch-2-console',
  'microsoft-xbox-series-x': 'microsoft-xbox-series-x-console',
  'sony-playstation-5': 'sony-playstation-5-console',
  // The home and personal computers, in release order. The M1 Mac mini is the
  // one machine of the fifteen left out: what Commons holds for it is a sealed
  // retail box and a view of the back panel whose case color and port count
  // disagree about which model was photographed.
  'apple-ii': 'apple-ii-computer',
  'atari-800': 'atari-800-computer',
  'ibm-pc-5150': 'ibm-pc-5150-computer',
  'bbc-micro-model-b': 'bbc-micro-model-b-computer',
  'zx-spectrum-48k': 'zx-spectrum-48k-computer',
  msx: 'msx-computer',
  'apple-macintosh-128k': 'apple-macintosh-128k-computer',
  'amstrad-cpc-464': 'amstrad-cpc-464-computer',
  'atari-520st': 'atari-520st-computer',
  'amiga-500': 'amiga-500-computer',
  'acorn-archimedes-a310': 'acorn-archimedes-a310-computer',
  'amiga-1200': 'amiga-1200-computer',
  'amiga-4000': 'amiga-4000-computer',
  'raspberry-pi-5': 'raspberry-pi-5-computer',
  'apple-mac-mini-m4': 'apple-mac-mini-m4-computer',
  // The graphics cards and the workstation, in release order. Six of the
  // thirteen are missing, and the reason is the same for all of them: Wikimedia
  // Commons holds die shots, bare boards with the cooler taken off, video
  // stills carrying a channel's own graphics, and cards glimpsed inside a lit
  // case, every one of which is a photograph of something other than the card
  // as it was sold.
  '3dfx-voodoo-graphics': '3dfx-voodoo-graphics-card',
  'nvidia-geforce-256': 'nvidia-geforce-256-card',
  'sgi-octane': 'sgi-octane-workstation',
  'nvidia-geforce-6800-ultra': 'nvidia-geforce-6800-ultra-card',
  'nvidia-geforce-gtx-580': 'nvidia-geforce-gtx-580-card',
  'amd-radeon-rx-7900-xtx': 'amd-radeon-rx-7900-xtx-card',
  'nvidia-geforce-rtx-5090': 'nvidia-geforce-rtx-5090-card',
  // The phones and portable machines, in release order. Four phones remain
  // unillustrated: Commons offers teardown parts for the 6s, a shop's
  // launch-day stall for the 12, a row of four handsets nobody can tell apart
  // for the 15 Pro, and a 17 Pro with a battery pack stuck to its back.
  'nintendo-game-boy': 'nintendo-game-boy-handheld',
  'apple-iphone-1st-generation': 'apple-iphone-1st-generation-phone',
  'game-boy-advance': 'game-boy-advance-handheld',
  'nintendo-ds': 'nintendo-ds-handheld',
  'apple-iphone-3gs': 'apple-iphone-3gs-phone',
  'apple-iphone-4': 'apple-iphone-4-phone',
  'apple-iphone-5s': 'apple-iphone-5s-phone',
  'apple-iphone-x': 'apple-iphone-x-phone',
  'apple-iphone-17': 'apple-iphone-17-phone',
  'valve-steam-deck': 'valve-steam-deck-handheld',
  // The guidance hardware. The Saturn LVDC stays unillustrated: the one
  // photograph of the whole computer on Commons is 600 pixels across and names
  // no photographer, and everything else there is a module inside a display
  // case or a page out of a manual.
  'apollo-guidance-computer-block-ii': 'apollo-guidance-computer-unit',
};

describe('lead images', () => {
  it('are attached to exactly the machines this increment illustrates', () => {
    const withImages = catalog.systems
      .filter((system) => (system.imageIds ?? []).length > 0)
      .map((system) => system.slug)
      .toSorted();
    expect(withImages).toEqual(Object.keys(ILLUSTRATED).toSorted());
  });

  it('resolve to the record and the file named by the first reference', () => {
    for (const [slug, imageId] of Object.entries(ILLUSTRATED)) {
      const system = catalog.systems.find((candidate) => candidate.slug === slug);
      expect(system).toBeDefined();
      if (system === undefined) {
        continue;
      }
      expect(system.imageIds?.[0]).toBe(imageId);

      // Resolving at all is the assertion: the lookup throws when a record
      // names a file the repository does not have. The pixel dimensions are not
      // checked here because Astro's image pipeline, which is what turns the
      // import into metadata, does not run under the unit tests; the canonical
      // file's own bytes are checked by data:validate instead.
      const lead = getLeadImage(system);
      expect(lead?.asset.id).toBe(imageId);
      expect(lead?.file).toBeDefined();
      expect(lead?.asset.canonical.width).toBe(1280);
      expect(lead?.asset.canonical.height).toBe(960);
      expect(lead?.asset.canonical.format).toBe('avif');
    }
  });

  it('carry the credit a reader has to be shown', () => {
    for (const imageId of Object.values(ILLUSTRATED)) {
      const asset = getImageById(imageId);
      expect(asset).toBeDefined();
      expect(asset?.attribution).toContain(asset?.creator ?? '');
      expect(asset?.alt.length ?? 0).toBeGreaterThan(20);
      expect(asset?.rights.statedAt).toBe(asset?.sourcePageUrl);
    }
  });

  it('are absent, not empty, on a machine with no photograph', () => {
    // A reference platform rather than a machine: nothing to photograph, so
    // this one stays unillustrated however many rounds of curation follow.
    const unillustrated = catalog.systems.find((system) => system.slug === 'intel-8086-pc');
    expect(unillustrated?.imageIds).toBeUndefined();
    expect(unillustrated === undefined ? undefined : getLeadImage(unillustrated)).toBeUndefined();
  });
});

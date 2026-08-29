// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Shared fixtures for the end-to-end suite.
 *
 * The route list is representative rather than exhaustive: one page of every
 * kind the site builds, chosen so that each has something the others do not. A
 * client-only island, a wide table, a chart, a page with no scripts at all. The
 * exhaustive pass over every route belongs to the prefixed suite, which is
 * checking a different property.
 */

import type { Page } from '@playwright/test';

/** The viewport matrix the blueprint asks for, smallest first. */
export const VIEWPORTS = [
  { name: '320×568', width: 320, height: 568 },
  { name: '375×667', width: 375, height: 667 },
  { name: '390×844', width: 390, height: 844 },
  { name: '768×1024', width: 768, height: 1024 },
  { name: '1024×768', width: 1024, height: 768 },
  { name: '1280×800', width: 1280, height: 800 },
  { name: '1440×900', width: 1440, height: 900 },
  { name: '1920×1080', width: 1920, height: 1080 },
] as const;

export const TIMELINE_SERIES = 'clock-frequency-cpu-nominal-clock';

/** One page of every kind, with what makes each one worth visiting. */
export const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/explore/', name: 'explore, filter island and every record' },
  { path: '/compare/', name: 'compare, the builder' },
  { path: '/compare/03-four-consoles/', name: 'a four-column prepared comparison' },
  { path: '/systems/commodore-64/', name: 'a system profile with two configurations' },
  /*
   * The Commodore 64 belongs to no family, so it renders no navbox. Without a
   * machine that has one, neither the axe pass nor the 320 px overflow matrix
   * would ever see the widest thing a profile can end with. The reference
   * PCs are the widest of all, at ten members.
   */
  {
    path: '/systems/intel-8086-pc/',
    name: 'a system profile whose family navbox has ten members',
  },
  { path: '/components/cpu/mos-6510/', name: 'a component profile' },
  { path: `/timeline/${TIMELINE_SERIES}/`, name: 'a chart page' },
  { path: '/methodology/', name: 'methodology' },
  { path: '/data/', name: 'data and contributing' },
] as const;

/**
 * A machine whose name is long enough to break a narrow layout, paired with one
 * whose figures are mostly absences: the two ways a comparison column goes
 * wrong.
 */
export const AWKWARD_COMPARE_QUERY =
  '?systems=apollo-guidance-computer-block-ii,nvidia-geforce-rtx-5090';

export const FOUR_UP_COMPARE_QUERY = '?systems=commodore-64,amiga-500,amiga-1200,sony-playstation';

/**
 * Whether the document scrolls sideways.
 *
 * One pixel of tolerance, because a sub-pixel layout width rounds up and a
 * scrollbar-free overflow of 0.5 px is not the failure this guards against.
 */
export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

/** Elements that stick out past the viewport, named so a failure says which. */
export async function overflowingElements(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    const names: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.right <= limit) {
        continue;
      }
      // A container that scrolls its own content sideways is allowed to hold
      // something wider than itself; that is what marking it was for.
      const scroller = element.closest('.scroll-x');
      if (scroller !== null && scroller !== element) {
        continue;
      }
      names.push(
        `${element.tagName.toLowerCase()}.${element.className || '(no class)'} → ${Math.round(box.right)}px`,
      );
    }
    return names.slice(0, 5);
  });
}

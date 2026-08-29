// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

/**
 * Base-aware URL helpers.
 *
 * Astro exposes the configured `base` as `import.meta.env.BASE_URL`, which is `/`
 * on a root domain and `/<repository>/` on GitHub Pages project pages. Every
 * internal link and asset reference goes through these helpers so the same build
 * works in both deployments.
 */

const BASE_URL: string = import.meta.env.BASE_URL;

const HAS_EXTENSION = /\.[a-z0-9]+$/i;

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** Prefixes an absolute site path with the configured base. */
export function withBase(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimTrailingSlash(BASE_URL)}${normalizedPath}` || '/';
}

/**
 * Prefixes a route and normalizes it to the site's `trailingSlash: 'always'`
 * policy. Paths that look like files (`/robots.txt`) keep their exact shape.
 */
export function route(path: string): string {
  const [pathname = '', suffix = ''] = splitSuffix(path);
  if (HAS_EXTENSION.test(pathname)) {
    return `${withBase(pathname)}${suffix}`;
  }
  return `${trimTrailingSlash(withBase(pathname))}/${suffix}`;
}

/** True when `pathname` is, or lives under, the given route. */
export function isActiveRoute(pathname: string, path: string): boolean {
  const target = trimTrailingSlash(route(path));
  const current = trimTrailingSlash(pathname);
  if (target === trimTrailingSlash(withBase('/'))) {
    return current === target;
  }
  return current === target || current.startsWith(`${target}/`);
}

function splitSuffix(path: string): [string, string] {
  const boundary = path.search(/[?#]/);
  if (boundary === -1) {
    return [path, ''];
  }
  return [path.slice(0, boundary), path.slice(boundary)];
}

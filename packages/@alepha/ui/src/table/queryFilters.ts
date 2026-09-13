import { type Alepha, type ZObject, coerceScalar, z } from "alepha";

/**
 * The two halves of a shareable filter link.
 *
 * `queryToFilters` reads the URL into filter values on arrival;
 * `filtersToQuery` writes the current values back out when the reader asks
 * for a link. Nothing here runs on its own: the table seeds from the query
 * once, at mount, and only ever writes on an explicit Share.
 *
 * ⚠️ The pair is deliberately NOT a two-way binding. An effect that keeps
 * the address bar in step with the filters is the shape Lore incident #156
 * was about (see `AppRouter.projectQuests`): the router state is a global
 * store, so the render on the way OUT of a page sees the next route's query
 * and writes against it.
 */

/**
 * Read the filter values a URL carries.
 *
 * Only keys declared by the filter `schema` are read, so query params the
 * page owns (a tab, a locale, a tracking param) never reach the fetch
 * payload. `keys` narrows that further when a table wants only some of its
 * filters to be linkable.
 *
 * Values arrive as strings and are coerced then decoded per field, the same
 * pair the server applies to its own query strings, which is what turns
 * `?limit=25` into a number and `?archived=true` into a boolean. A value the
 * schema refuses is DROPPED rather than thrown: a stale bookmark has to
 * degrade to the unfiltered list, never to an error page.
 *
 * Multi-value filters are comma-joined (`?status=new,triaged`). Repeated
 * params are not an option: `ReactBrowserRouterProvider` builds its query
 * from `URLSearchParams.entries()` into a flat record, so `?status=new&status=triaged`
 * arrives as `triaged` alone.
 *
 * Returns `undefined` rather than `{}` when nothing matches, because the
 * caller hands this to the table's seed slot, and an empty seed still
 * outranks the filters the reader chose last time.
 */
export const queryToFilters = (
  alepha: Alepha,
  schema: ZObject,
  query: Record<string, any>,
  keys?: readonly string[],
): Record<string, any> | undefined => {
  const shape = z.schema.shape(schema);
  const out: Record<string, any> = {};

  for (const [key, field] of Object.entries(shape)) {
    if (keys && !keys.includes(key)) continue;
    const raw = query[key];
    if (typeof raw !== "string" || raw === "") continue;

    const base = z.schema.unwrap(field);
    const input = z.schema.isArray(base)
      ? raw
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== "")
      : raw;

    try {
      out[key] = alepha.codec.decode(field as any, coerceScalar(field, input));
    } catch {
      // A value this schema no longer accepts, from a link written against
      // an older shape. The rest of the link still applies.
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
};

/**
 * Serialize filter values into query params for a shareable link.
 *
 * Strings, numbers, booleans and arrays of those. Anything else is dropped:
 * a link carrying some of the filters is honest, and one carrying
 * `[object Object]` is not.
 */
export const filtersToQuery = (
  values: Record<string, any>,
): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      const parts = value.filter((item) => isScalar(item)).map(String);
      if (parts.length > 0) out[key] = parts.join(",");
      continue;
    }

    if (isScalar(value)) out[key] = String(value);
  }

  return out;
};

const isScalar = (value: unknown): boolean =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/**
 * The link the toolbar's Share item copies.
 *
 * Built on the page's own URL, so query params the table knows nothing about
 * (a tab, a locale, a campaign) survive into the shared link. Every filter
 * key is cleared first, which is what makes a filter the reader has since
 * removed disappear from the link rather than linger from the URL they
 * arrived on.
 *
 * Commas are written literally. `URLSearchParams` percent-encodes them, and
 * `?status=new%2Ctriaged` defeats the point of a link somebody reads before
 * clicking it. A comma is a legal sub-delimiter in a query, and it round-trips
 * back through `queryToFilters` either way.
 */
export const shareFiltersUrl = (
  href: string,
  keys: readonly string[],
  values: Record<string, any>,
): string => {
  const url = new URL(href);

  for (const key of keys) {
    url.searchParams.delete(key);
  }
  for (const [key, value] of Object.entries(filtersToQuery(values))) {
    url.searchParams.set(key, value);
  }

  url.search = url.search.replace(/%2C/g, ",");
  return url.toString();
};

/**
 * The filter values that are actually narrowing the list.
 *
 * Empty is not a filter: an untouched text input holds `""` and a
 * multi-select the reader emptied holds `[]`, and neither should be stored,
 * counted on the toolbar badge, or written into a shared link. One
 * definition rather than three, because the three used to disagree on
 * nothing at all and that is exactly how they would drift.
 */
export const cleanFilterValues = (
  values: Record<string, any>,
): Record<string, any> => {
  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }

  return out;
};

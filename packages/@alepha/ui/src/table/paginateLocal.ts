import type { Page } from "alepha";

export interface PaginateLocalOptions<T> {
  /**
   * Zero-based page index, exactly as AlephaTable holds it.
   */
  page: number;
  size: number;
  /**
   * Alepha's sort param: `"field"` ascending, `"-field"` descending.
   * Only a single field is honoured — a static table has no server to
   * hand a multi-column sort to.
   */
  sort?: string;
  /**
   * Value accessors keyed by sort field, for columns whose sort key is not
   * a plain property of the row (a derived total, a joined label). Falls
   * back to `item[field]`.
   */
  sortValues?: Record<string, (item: T) => unknown>;
  /**
   * Current filter form values, straight off AlephaTable's filter form.
   */
  filters?: Record<string, any>;
  /**
   * Predicate replacing the built-in field matching entirely.
   *
   * Reach for it as soon as a filter is not a field: a `search` box that
   * spans title and description, a range, a joined label. Only ever called
   * with filter values that are actually set.
   */
  filter?: (item: T, filters: Record<string, any>) => boolean;
}

/**
 * Does one filter value match the same-named property of a row?
 *
 * Sugar for the common case, not a query language. Strings match as a
 * case-insensitive substring (what a text box means), arrays match on
 * membership (what a tag picker means), everything else compares strictly.
 * Anything more expressive is the caller's `filter`.
 */
const matchesField = (item: unknown, key: string, value: unknown): boolean => {
  // A filter field the rows do not carry belongs to a caller-owned
  // `filter`. Emptying the table is the worst possible way to report that,
  // so an unknown key matches everything and stays visible instead.
  if (!(key in (item as object))) {
    return true;
  }
  const cell = (item as Record<string, unknown>)[key];
  if (Array.isArray(cell)) {
    return cell.some((entry) =>
      typeof entry === "string" && typeof value === "string"
        ? entry.toLowerCase() === value.toLowerCase()
        : entry === value,
    );
  }
  if (typeof cell === "string" && typeof value === "string") {
    return cell.toLowerCase().includes(value.toLowerCase());
  }
  return cell === value;
};

/**
 * Compare two non-nullish cell values.
 *
 * Typed rather than stringified: `String(a) < String(b)` puts 10 before 2
 * and 2026-01-02 before 2026-01-10, which reads as a sorted column that is
 * quietly wrong. Strings fall through to `localeCompare` at `sensitivity:
 * "base"` so "Apple" and "apple" land together instead of ASCII-uppercase
 * first.
 */
const compareValues = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return String(a).localeCompare(String(b), undefined, {
    sensitivity: "base",
  });
};

/**
 * Client-side sort + slice over an in-memory array, shaped as the same
 * `Page<T>` a server fetcher returns.
 *
 * This is the whole of AlephaTable's static-data mode: the component swaps
 * its fetched `data`/`meta` for this function's output and every other part
 * of the table (pager, selection, column picker, row actions) keeps working
 * against the shape it already knows.
 */
export const paginateLocal = <T>(
  items: T[],
  options: PaginateLocalOptions<T>,
): Page<T> => {
  const { page, size } = options;

  let working = items;

  // A cleared Control sets `undefined`; an emptied text input sets "".
  // Either one treated as a real value empties the table for no reason the
  // reader can see, so they are dropped before anything else looks at them.
  const active = Object.entries(options.filters ?? {}).filter(
    ([, value]) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0),
  );

  if (active.length > 0) {
    const values = Object.fromEntries(active);
    working = working.filter((item) =>
      options.filter
        ? options.filter(item, values)
        : active.every(([key, value]) => matchesField(item, key, value)),
    );
  }

  if (options.sort) {
    const descending = options.sort.startsWith("-");
    const field = descending ? options.sort.slice(1) : options.sort;
    const accessor =
      options.sortValues?.[field] ??
      ((item: T) => (item as Record<string, unknown>)[field]);
    const direction = descending ? -1 : 1;

    // Copy `working`, not `items`: sorting the original array back over the
    // filtered one throws the filter away. Copy at all because `sort`
    // mutates, and the array belongs to the caller — reordering their state
    // in place would be a side effect they never asked for and cannot see.
    // `sort` is stable, so rows that compare equal keep the order the caller
    // put them in.
    working = [...working].sort((left, right) => {
      const a = accessor(left);
      const b = accessor(right);
      const aEmpty = a === null || a === undefined || a === "";
      const bEmpty = b === null || b === undefined || b === "";
      // Nullish last, and outside the direction flip: an empty cell is
      // missing data, and burying it is right whichever way the reader
      // pointed the arrow.
      if (aEmpty || bEmpty) {
        return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
      }
      return compareValues(a, b) * direction;
    });
  }

  const offset = page * size;
  const content = working.slice(offset, offset + size);
  const totalPages = Math.ceil(working.length / size);

  return {
    content,
    page: {
      number: page,
      size,
      offset,
      numberOfElements: content.length,
      totalElements: working.length,
      totalPages,
      isEmpty: content.length === 0,
      isFirst: page === 0,
      // `>=` rather than `===`: a page past the end is still the last thing
      // there is to show, and the pager must not offer a "next" from it.
      isLast: page >= totalPages - 1,
    },
  };
};

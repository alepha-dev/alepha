/**
 * A resource kind in the reader's language, falling back to the raw value.
 *
 * The fallback is load-bearing rather than defensive: a new `$audit` type
 * reaches this page the moment it is declared, before anybody has written its
 * label, and printing `Sigil` beats printing a missing translation key.
 *
 * It is CAPITALIZED, because the fallback sits in a list of labels and has to
 * read as one. An unlabelled kind used to print `app` between `Epic` and
 * `Feedback`, which read as a database value that had leaked into the UI
 * rather than as the one entry nobody had translated yet (feedback #P2151).
 */
export const activityResourceLabel = (
  tr: (key: any, options?: any) => string,
  type: string,
): string =>
  tr(`activity.resource.${type}` as never, { default: capitalize(type) });

/**
 * The first letter uppercased, for values that are displayed as labels but
 * stored as verbs.
 *
 * `$audit` actions are an open set - every declaration names its own - so a
 * locale key per verb is the wrong shape: it would need a translation before
 * a new verb could be shown at all, and the filter's job is to list what the
 * table actually holds. Capitalizing at the point of display leaves the stored
 * verb, the query parameter and the filter's value untouched.
 */
export const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

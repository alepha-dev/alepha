/**
 * The reserved query key a link uses to say something about a table's filters
 * as a whole, rather than about one filter. Never a filter's own key.
 */
export const DATA_TABLE_FILTERS_QUERY_KEY = "filters";

/**
 * `?filters=none`: open the list with exactly the filters the link carries,
 * none of the reader's stored ones, even when the link carries no filter.
 * Read only by a table that set `filters.fromQuery`.
 */
export const DATA_TABLE_NO_STORED_FILTERS = "none";

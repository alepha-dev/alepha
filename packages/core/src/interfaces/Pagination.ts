/**
 * Generic pagination request parameters.
 *
 * This interface defines the common structure for pagination queries
 * across all data sources. Individual packages can extend or adapt this
 * interface for their specific needs.
 *
 * @example Basic usage
 * ```ts
 * const query: PageRequest = {
 *   page: 0,
 *   size: 20
 * };
 * ```
 *
 * @example With all parameters
 * ```ts
 * const query: PageRequest = {
 *   page: 2,
 *   size: 50
 * };
 * ```
 */
export interface PageRequest {
  /**
   * The page number to retrieve (0-indexed).
   * @default 0
   */
  page?: number;

  /**
   * The number of items per page.
   * @default 10
   */
  size?: number;
}

/**
 * Sort direction for ordering results.
 */
export type SortDirection = "asc" | "desc";

/**
 * Sort field specification.
 */
export interface SortField {
  /**
   * The field/column name to sort by.
   */
  field: string;

  /**
   * The sort direction.
   * @default "asc"
   */
  direction: SortDirection;
}

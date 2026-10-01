import type { Page } from "../schemas/pageSchema.ts";

/**
 * Create a pagination object from an array of entities.
 *
 * This is a pure function that works with any data source (databases, APIs, caches, arrays, etc.).
 * It handles the core pagination logic including:
 * - Slicing the content to the requested page size
 * - Calculating pagination metadata (offset, page number, etc.)
 * - Determining navigation state (isFirst, isLast)
 * - Including sort metadata when provided
 *
 * @param entities - The entities to paginate (should include one extra item to detect if there's a next page)
 * @param limit - The limit of the pagination (page size)
 * @param offset - The offset of the pagination (starting position)
 * @param sort - Optional sort metadata to include in response
 * @returns A complete Page object with content and metadata
 *
 * @example Basic pagination
 * ```ts
 * const users = await fetchUsers({ limit: 11, offset: 0 }); // Fetch limit + 1
 * const page = createPagination(users, 10, 0);
 * // page.content has max 10 items
 * // page.page.isLast tells us if there are more pages
 * ```
 *
 * @example With sorting
 * ```ts
 * const page = createPagination(
 *   entities,
 *   10,
 *   0,
 *   [{ column: "name", direction: "asc" }]
 * );
 * ```
 *
 * @example In a custom service
 * ```ts
 * class MyService {
 *   async listItems(page: number, size: number) {
 *     const items = await this.fetchItems({ limit: size + 1, offset: page * size });
 *     return createPagination(items, size, page * size);
 *   }
 * }
 * ```
 */
export function createPagination<T>(
  entities: T[],
  limit = 10,
  offset = 0,
  sort?: Array<{ column: string; direction: "asc" | "desc" }>,
): Page<T> {
  const content = entities.slice(0, limit);
  // `>` not `===`: a caller that passes an unsliced result set (length far
  // beyond limit+1) would otherwise be told it is on the last page.
  const hasNext = entities.length > limit;
  const pageNumber = limit > 0 ? Math.floor(offset / limit) : 0;

  return {
    content,
    page: {
      number: pageNumber,
      size: limit,
      offset,
      numberOfElements: content.length,
      isEmpty: content.length === 0,
      isFirst: pageNumber === 0,
      isLast: !hasNext,
      ...(sort && sort.length > 0
        ? {
            sort: {
              sorted: true,
              fields: sort.map((s) => ({
                field: s.column,
                direction: s.direction,
              })),
            },
          }
        : {}),
    },
  };
}

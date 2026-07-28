import {
  type Static,
  type TArray,
  type TObject,
  type TRecord,
  z,
} from "../providers/TypeProvider.ts";

export const pageMetadataSchema = z.object({
  number: z.integer().describe("Page number, starting from 0"),
  size: z.integer().describe("Number of items per page (requested page size)"),
  offset: z.integer().describe("Offset in the dataset (page × size)"),
  numberOfElements: z
    .integer()
    .describe(
      "Number of elements in THIS page (content.length). Different from totalElements which is the total across all pages.",
    ),
  totalElements: z
    .integer()
    .describe(
      "Total number of elements across all pages. Only available when counting is enabled.",
    )
    .optional(),
  totalPages: z
    .integer()
    .describe(
      "Total number of pages. Only available when `totalElements` is present.",
    )
    .optional(),
  isEmpty: z
    .boolean()
    .describe(
      "Indicates if the current page has no items (numberOfElements === 0)",
    ),
  isFirst: z
    .boolean()
    .describe("Indicates if this is the first page (number === 0)"),
  isLast: z
    .boolean()
    .describe("Indicates if this is the last page (no more pages after this)"),
  sort: z
    .object({
      sorted: z.boolean().describe("Whether the results are sorted"),
      fields: z.array(
        z.object({
          field: z.text({
            description: "The field used for sorting",
          }),
          direction: z
            .enum(["asc", "desc"])
            .describe("The direction of the sort. Either 'asc' or 'desc'"),
        }),
      ),
    })
    .optional(),
});

/**
 * Create a pagination schema for the given object schema.
 *
 * Provides a standardized pagination response format compatible with Spring Data's Page interface.
 * This schema can be used across any data source (databases, APIs, caches, etc.).
 *
 * @example
 * ```ts
 * const userSchema = z.object({ id: z.integer(), name: z.text() });
 * const userPageSchema = pageSchema(userSchema);
 * ```
 *
 * @example In an API endpoint
 * ```ts
 * $action({
 *   output: pageSchema(UserSchema),
 *   handler: async () => {
 *     return await userRepo.paginate();
 *   }
 * })
 * ```
 */
export const pageSchema = <T extends TObject | TRecord>(
  objectSchema: T,
): TPage<T> =>
  z.object({
    content: z.array(objectSchema),
    page: pageMetadataSchema,
  }) as unknown as TPage<T>;

export type TPage<T extends TObject | TRecord> = TObject<{
  content: TArray<T>;
  page: typeof pageMetadataSchema;
}>;

/**
 * Opinionated type definition for a paginated response.
 *
 * Inspired by Spring Data's Page interface with all essential pagination metadata.
 * This generic type can be used with any data source.
 *
 * @example
 * ```ts
 * const page: Page<User> = {
 *   content: [user1, user2, ...],
 *   page: {
 *     number: 0,
 *     size: 10,
 *     offset: 0,
 *     numberOfElements: 10,
 *     totalElements: 1200,
 *     totalPages: 120,
 *     isEmpty: false,
 *     isFirst: true,
 *     isLast: false,
 *     sort: {
 *       sorted: true,
 *       fields: [
 *         { field: "name", direction: "asc" }
 *       ]
 *     }
 *   }
 * }
 * ```
 */
export type Page<T> = {
  /**
   * Array of items on the current page.
   */
  content: T[];
  page: Static<typeof pageMetadataSchema>;
};

export type PageMetadata = Static<typeof pageMetadataSchema>;

// ---------------------------------------------------------------------------------------------------------------------

// NOTE: this file used to augment `TypeProvider` with a `page()` method and
// assign it on the prototype. `TypeProvider` is a static-only legacy config
// holder — nothing ever constructs it — so the instance method was
// unreachable. `z.page` (ZodProvider) is the live implementation.

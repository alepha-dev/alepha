import {
  type Static,
  type TArray,
  type TObject,
  type TObjectOptions,
  type TRecord,
  TypeProvider,
  t,
} from "../providers/TypeProvider.ts";

export const pageMetadataSchema = t.object({
  number: t.integer({ description: "Page number, starting from 0" }),
  size: t.integer({
    description: "Number of items per page (requested page size)",
  }),
  offset: t.integer({
    description: "Offset in the dataset (page × size)",
  }),
  numberOfElements: t.integer({
    description:
      "Number of elements in THIS page (content.length). Different from totalElements which is the total across all pages.",
  }),
  totalElements: t.optional(
    t.integer({
      description:
        "Total number of elements across all pages. Only available when counting is enabled.",
    }),
  ),
  totalPages: t.optional(
    t.integer({
      description:
        "Total number of pages. Only available when `totalElements` is present.",
    }),
  ),
  isEmpty: t.boolean({
    description:
      "Indicates if the current page has no items (numberOfElements === 0)",
  }),
  isFirst: t.boolean({
    description: "Indicates if this is the first page (number === 0)",
  }),
  isLast: t.boolean({
    description:
      "Indicates if this is the last page (no more pages after this)",
  }),
  sort: t.optional(
    t.object({
      sorted: t.boolean({
        description: "Whether the results are sorted",
      }),
      fields: t.array(
        t.object({
          field: t.text({
            description: "The field used for sorting",
          }),
          direction: t.enum(["asc", "desc"], {
            description: "The direction of the sort. Either 'asc' or 'desc'",
          }),
        }),
      ),
    }),
  ),
});

/**
 * Create a pagination schema for the given object schema.
 *
 * Provides a standardized pagination response format compatible with Spring Data's Page interface.
 * This schema can be used across any data source (databases, APIs, caches, etc.).
 *
 * @example
 * ```ts
 * const userSchema = t.object({ id: t.integer(), name: t.text() });
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
  options?: TObjectOptions,
): TPage<T> =>
  t.object(
    {
      content: t.array(objectSchema),
      page: pageMetadataSchema,
    },
    options,
  );

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

declare module "alepha" {
  interface TypeProvider {
    /**
     * Create a schema for a paginated response.
     */
    page<T extends TObject | TRecord>(itemSchema: T): TPage<T>;
  }
}

TypeProvider.prototype.page = (itemSchema) => pageSchema(itemSchema);

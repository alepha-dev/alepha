import type {
  TArray,
  TBoolean,
  TInteger,
  TObject,
  TObjectOptions,
  TOptionalAdd,
  TRecord,
  TSchema,
  TString,
} from "../providers/TypeProvider.ts";
import { t } from "../providers/TypeProvider.ts";

/**
 * Create a pagination schema for the given object schema.
 *
 * Provides a standardized pagination response format compatible with Spring Data's Page interface.
 * This schema can be used across any data source (databases, APIs, caches, etc.).
 *
 * @example
 * ```ts
 * const userSchema = t.object({ id: t.int(), name: t.text() });
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
      page: t.object({
        number: t.int(),
        size: t.int(),
        offset: t.int(),
        numberOfElements: t.int(),
        totalElements: t.optional(t.int()),
        totalPages: t.optional(t.int()),
        isEmpty: t.boolean(),
        isFirst: t.boolean(),
        isLast: t.boolean(),
        sort: t.optional(
          t.object({
            sorted: t.boolean(),
            fields: t.array(
              t.object({
                field: t.text(),
                direction: t.enum(["asc", "desc"]),
              }),
            ),
          }),
        ),
      }),
    },
    options,
  );

export type TPage<T extends TObject | TRecord> = TObject<{
  content: TArray<T>;
  page: TObject<{
    number: TInteger;
    size: TInteger;
    offset: TInteger;
    numberOfElements: TInteger;
    totalElements: TOptionalAdd<TInteger>;
    totalPages: TOptionalAdd<TInteger>;
    isEmpty: TBoolean;
    isFirst: TBoolean;
    isLast: TBoolean;
    sort: TOptionalAdd<
      TObject<{
        sorted: TBoolean;
        fields: TArray<
          TObject<{
            field: TString;
            direction: TSchema;
          }>
        >;
      }>
    >;
  }>;
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
  page: {
    /**
     * Page number, starting from 0.
     */
    number: number;
    /**
     * Number of items per page (requested page size).
     */
    size: number;
    /**
     * Offset in the dataset (page × size).
     */
    offset: number;
    /**
     * Number of elements in THIS page (content.length).
     * Different from totalElements which is the total across all pages.
     */
    numberOfElements: number;
    /**
     * Total number of elements across all pages.
     * Only available when counting is enabled.
     */
    totalElements?: number;
    /**
     * Total number of pages.
     * Only available when `totalElements` is present.
     */
    totalPages?: number;
    /**
     * Indicates if the current page has no items (numberOfElements === 0).
     */
    isEmpty: boolean;
    /**
     * Indicates if this is the first page (number === 0).
     */
    isFirst: boolean;
    /**
     * Indicates if this is the last page (no more pages after this).
     */
    isLast: boolean;
    /**
     * Sort metadata indicating what sorting was applied.
     * Only present when sorting is applied.
     */
    sort?: {
      /**
       * Whether the results are sorted.
       */
      sorted: boolean;
      /**
       * The fields and directions used for sorting.
       */
      fields: Array<{
        field: string;
        direction: "asc" | "desc";
      }>;
    };
  };
};

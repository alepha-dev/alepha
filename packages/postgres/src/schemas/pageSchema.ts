import type {
  TArray,
  TBoolean,
  TInteger,
  TObject,
  TObjectOptions,
  TOptionalAdd,
  TRecord,
} from "@alepha/core";
import { t } from "@alepha/core";

/**
 * Create a pagination schema for the given object schema.
 *
 * > use `pg.page` directly.
 *
 * @example
 * ```ts
 * const userSchema = t.object({ id: t.int(), name: t.text() });
 * const userPageSchema = pageSchema(userSchema);
 * ```
 *
 * @see {@link $repository#paginate}
 */
export const pageSchema = <T extends TObject | TRecord>(
  objectSchema: T,
  options?: TObjectOptions,
): TPage<T> =>
  t.object(
    {
      content: t.array(objectSchema),
      can: t.object({
        next: t.boolean(),
        previous: t.boolean(),
      }),
      page: t.object({
        number: t.int(),
        size: t.int(),
        totalElements: t.optional(t.int()),
      }),
    },
    options,
  );

export type TPage<T extends TObject | TRecord> = TObject<{
  content: TArray<T>;
  can: TObject<{ next: TBoolean; previous: TBoolean }>;
  page: TObject<{
    number: TInteger;
    size: TInteger;
    totalElements: TOptionalAdd<TInteger>;
  }>;
}>;

/**
 * Opinionated type definition for a paginated response.
 *
 * @example
 * ```ts
 * const page = {
 *   content: [ ... ]
 *   can: {
 *     next: true,
 *     previous: false
 *   },
 *   page: {
 *     number: 0,
 *     size: 10,
 *     totalElements: 1200
 *   }
 * }
 * ```
 */
export type Page<T> = {
  /**
   * Array of items on the current page.
   */
  content: T[];
  can: {
    /**
     * Indicates if there is a next page.
     */
    next: boolean;
    /**
     * Indicates if there is a previous page.
     */
    previous: boolean;
  };
  page: {
    /**
     * Page number, starting from 0.
     */
    number: number;
    /**
     * Number of items per page.
     */
    size: number;
    /**
     * Requires `count: true` in the paginate options.
     */
    totalElements?: number;
  };
};

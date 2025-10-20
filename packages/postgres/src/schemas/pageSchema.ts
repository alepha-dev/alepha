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
 * @example
 * const userSchema = t.object({ id: t.int(), name: t.text() });
 * const pagedUserSchema = pageSchema(userSchema);
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

export type Page<T> = {
  content: T[];
  can: { next: boolean; previous: boolean };
  page: {
    number: number;
    size: number;
    totalElements?: number;
  };
};

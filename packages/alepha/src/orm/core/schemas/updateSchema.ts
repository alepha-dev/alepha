import {
  type TNull,
  type TObject,
  type TOptional,
  type TSchema,
  type TUnion,
  z,
} from "alepha";
import { PG_GENERATED } from "../constants/PG_SYMBOLS.ts";

/**
 * Transforms a TObject schema for update operations.
 * All optional properties at the root level are made nullable (i.e., `T | null`).
 * Generated columns are excluded entirely.
 *
 * @example
 * Before: { name?: string; age: number; fullName: generated }
 * After:  { name?: string | null; age: number; }
 */
export type TObjectUpdate<T extends TObject> = TObject<{
  [K in keyof T["shape"] as T["shape"][K] extends { [PG_GENERATED]: any }
    ? never
    : K]: T["shape"][K] extends TOptional<infer U extends TSchema>
    ? TOptional<TUnion<[U, TNull]>>
    : T["shape"][K];
}>;

export const updateSchema = <T extends TObject>(
  schema: T,
): TObjectUpdate<T> => {
  const newProperties: Record<string, any> = {};

  for (const key in schema.shape) {
    const prop = schema.shape[key];

    // Skip generated columns — they are computed by the database
    if (PG_GENERATED in prop) {
      continue;
    }

    if (z.schema.isOptional(prop)) {
      newProperties[key] = z.union([prop, z.null()]).optional();
    } else {
      newProperties[key] = prop;
    }
  }

  return z.object(newProperties) as unknown as TObjectUpdate<T>;
};

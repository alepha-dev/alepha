import {
  type TNull,
  type TObject,
  type TOptional,
  type TUnion,
  t,
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
  [K in keyof T["properties"] as T["properties"][K] extends {
    [PG_GENERATED]: any;
  }
    ? never
    : K]: T["properties"][K] extends TOptional<infer U>
    ? TOptional<TUnion<[U, TNull]>>
    : T["properties"][K];
}>;

export const updateSchema = <T extends TObject>(
  schema: T,
): TObjectUpdate<T> => {
  const newProperties: Record<string, any> = {};

  for (const key in schema.properties) {
    const prop = schema.properties[key];

    // Skip generated columns — they are computed by the database
    if (PG_GENERATED in prop) {
      continue;
    }

    if (t.schema.isOptional(prop)) {
      newProperties[key] = t.optional(t.union([prop, t.raw.Null()]));
    } else {
      newProperties[key] = prop;
    }
  }

  return t.object(
    newProperties,
    "options" in schema && typeof schema.options === "object"
      ? { ...schema.options }
      : {},
  ) as TObjectUpdate<T>;
};

import {
  type ZObject,
  type ZodNull,
  type ZodOptional,
  type ZodUnion,
  type ZType,
  z,
} from "alepha";

import { PG_GENERATED } from "../constants/PG_SYMBOLS.ts";

/**
 * Transforms a ZObject schema for update operations.
 * All optional properties at the root level are made nullable (i.e., `T | null`).
 * Generated columns are excluded entirely.
 *
 * @example
 * Before: { name?: string; age: number; fullName: generated }
 * After:  { name?: string | null; age: number; }
 */
export type TObjectUpdate<T extends ZObject> = ZObject<{
  [
    K in keyof T["shape"] as T["shape"][K] extends { [PG_GENERATED]: any }
      ? never
      : K
  ]: T["shape"][K] extends ZodOptional<infer U extends ZType>
    ? ZodOptional<ZodUnion<[U, ZodNull]>>
    : T["shape"][K];
}>;

export const updateSchema = <T extends ZObject>(
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

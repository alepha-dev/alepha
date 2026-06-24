import type { TObject, TOptional, TSchema } from "alepha";
import { z } from "alepha";
import {
  PG_DEFAULT,
  PG_GENERATED,
  PG_ORGANIZATION,
} from "../constants/PG_SYMBOLS.ts";

/**
 * Transforms a TObject schema for insert operations.
 * All default properties at the root level are made optional.
 * Generated columns are excluded entirely.
 *
 * @example
 * Before: { name: string; age: number(default=0); fullName: generated }
 * After:  { name: string; age?: number; }
 */
export type TObjectInsert<T extends TObject> = TObject<{
  [K in keyof T["shape"] as T["shape"][K] extends { [PG_GENERATED]: any }
    ? never
    : K]: T["shape"][K] extends
    | { [PG_DEFAULT]: any }
    | { [PG_ORGANIZATION]: any }
    ? TOptional<Extract<T["shape"][K], TSchema>>
    : T["shape"][K];
}>;

export const insertSchema = <T extends TObject>(obj: T): TObjectInsert<T> => {
  const newProperties: Record<string, any> = {};

  for (const key in obj.shape) {
    const prop = obj.shape[key];

    // Skip generated columns — they are computed by the database
    if (PG_GENERATED in prop) {
      continue;
    }

    if (PG_DEFAULT in prop || PG_ORGANIZATION in prop) {
      // PG_DEFAULT fields have a server-side default; PG_ORGANIZATION fields are
      // auto-stamped by stampOrganization() inside create(). Both are optional
      // at the TypeScript call-site even when the DB column is NOT NULL.
      newProperties[key] = prop.optional();
    } else if (z.schema.isOptional(prop)) {
      // An optional field maps to a NULLABLE column, so an explicit `null` is a
      // valid insert value (means "no value"), not just `undefined`.
      newProperties[key] = z.schema.unwrap(prop).nullable().optional();
    } else {
      newProperties[key] = prop;
    }
  }

  return z.object(newProperties) as unknown as TObjectInsert<T>;
};

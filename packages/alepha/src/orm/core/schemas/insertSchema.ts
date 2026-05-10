import type { TObject, TOptional } from "alepha";
import { t } from "alepha";
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
  [K in keyof T["properties"] as T["properties"][K] extends {
    [PG_GENERATED]: any;
  }
    ? never
    : K]: T["properties"][K] extends
    | { [PG_DEFAULT]: any }
    | { [PG_ORGANIZATION]: any }
    | { "~optional": true }
    ? TOptional<T["properties"][K]>
    : T["properties"][K];
}>;

export const insertSchema = <T extends TObject>(obj: T): TObjectInsert<T> => {
  const newProperties: Record<string, any> = {};

  for (const key in obj.properties) {
    const prop = obj.properties[key];

    // Skip generated columns — they are computed by the database
    if (PG_GENERATED in prop) {
      continue;
    }

    if (PG_DEFAULT in prop || PG_ORGANIZATION in prop) {
      // PG_DEFAULT fields have a server-side default; PG_ORGANIZATION fields are
      // auto-stamped by stampOrganization() inside create(). Both are optional
      // at the TypeScript call-site even when the DB column is NOT NULL.
      newProperties[key] = t.optional(prop);
    } else {
      newProperties[key] = prop;
    }
  }

  return t.object(
    newProperties,
    "options" in obj && typeof obj.options === "object"
      ? { ...obj.options }
      : {},
  ) as TObjectInsert<T>;
};

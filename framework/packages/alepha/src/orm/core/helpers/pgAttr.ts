import type { ZObject, ZType } from "alepha";
import { AlephaError } from "alepha";

import type { PgSymbolKeys, PgSymbols } from "../constants/PG_SYMBOLS.ts";

/**
 * Decorates a zod schema with a Postgres attribute.
 *
 * > It's just a fancy way to add Symbols to a field.
 *
 * It returns a tagged copy and leaves `type` alone: a schema shared between
 * entities (`userIdSchema`) must not turn into a foreign key everywhere
 * because one entity wrapped it in `db.ref()`. The attributes `type` already
 * carries are copied onto the result.
 *
 * @example
 * ```ts
 * import { z } from "alepha";
 * import { PG_UPDATED_AT } from "../constants/PG_SYMBOLS";
 *
 * export const updatedAtSchema = pgAttr(
 *   z.datetime(), PG_UPDATED_AT,
 * );
 * ```
 */
export const pgAttr = <T extends ZType, Attr extends PgSymbolKeys>(
  type: T,
  attr: Attr,
  value?: PgSymbols[Attr],
): PgAttr<T, Attr> => {
  const tagged = cloneSchema(type);
  Object.assign(tagged, { [attr]: value ?? {} });
  return tagged as PgAttr<T, Attr>;
};

/**
 * A copy of a schema that keeps the Postgres attributes (and the column
 * default `db.default()` records) of the original.
 */
export const cloneSchema = <T extends ZType>(type: T): T => {
  const copy = (type as any).clone() as T;
  for (const symbol of Object.getOwnPropertySymbols(type)) {
    if (symbol.description?.startsWith("Alepha.Postgres.")) {
      (copy as any)[symbol] = (type as any)[symbol];
    }
  }
  if (Object.hasOwn(type, "default")) {
    (copy as any).default = (type as any).default;
  }
  return copy;
};

/**
 * The value of a Postgres attribute on a column schema, looking through the
 * wrappers that only change optionality: `optional`, `nullable`, `default`
 * and `readonly`. So `db.ref(x).optional()` and `db.ref(x.optional())` both
 * carry the reference.
 */
export const getAttr = <Attr extends PgSymbolKeys>(
  type: unknown,
  attr: Attr,
): PgSymbols[Attr] | undefined => {
  let current = type as any;
  while (current != null) {
    if (attr in current) {
      return current[attr];
    }
    const def = current._zod?.def;
    if (!def || !TRANSPARENT_WRAPPERS.has(def.type)) {
      return undefined;
    }
    current = def.innerType;
  }
  return undefined;
};

/**
 * Whether a column schema carries a Postgres attribute (see {@link getAttr}).
 */
export const hasAttr = (type: unknown, attr: PgSymbolKeys): boolean =>
  getAttr(type, attr) !== undefined;

/**
 * Refuse a column whose Postgres attribute sits under a wrapper the readers
 * do not look through (`pipe`, `transform`, `catch`, ...): the attribute
 * would be dropped silently, and a foreign key or a primary key with it.
 */
export const assertAttrsReachable = (
  entityName: string,
  schema: ZObject,
): void => {
  for (const key of Object.keys(schema.shape)) {
    const hidden = findHiddenAttr(schema.shape[key], false);
    if (hidden) {
      throw new AlephaError(
        `Column '${entityName}.${key}' carries ${hidden.description} under a '${hidden.wrapper}' wrapper, where it is not read. ` +
          `Apply the db.* helper to the schema inside the wrapper, or move the wrapper inside the helper.`,
      );
    }
  }
};

/**
 * The first Postgres attribute found below an opaque wrapper, if any.
 */
const findHiddenAttr = (
  type: unknown,
  hidden: boolean,
  wrapper = "",
  depth = 0,
): { description: string; wrapper: string } | undefined => {
  const current = type as any;
  if (current == null || typeof current !== "object" || depth > 16) {
    return undefined;
  }
  if (hidden) {
    const symbol = Object.getOwnPropertySymbols(current).find((it) =>
      it.description?.startsWith("Alepha.Postgres."),
    );
    if (symbol) {
      return { description: symbol.description!, wrapper };
    }
  }
  const def = current._zod?.def;
  if (!def) {
    return undefined;
  }
  const opaque = !TRANSPARENT_WRAPPERS.has(def.type);
  const nextHidden = hidden || opaque;
  const nextWrapper = hidden ? wrapper : def.type;
  for (const inner of [def.innerType, def.in, def.out]) {
    if (inner) {
      const found = findHiddenAttr(inner, nextHidden, nextWrapper, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
};

/**
 * The zod wrappers {@link getAttr} looks through.
 */
const TRANSPARENT_WRAPPERS = new Set([
  "optional",
  "nullable",
  "default",
  "readonly",
]);

/**
 * Retrieves the fields of a schema that have a specific attribute.
 */
export const getAttrFields = (
  schema: ZObject,
  name: PgSymbolKeys,
): PgAttrField[] => {
  const fields: Array<PgAttrField> = [];

  for (const key of Object.keys(schema.shape)) {
    const value = schema.shape[key];
    const data = getAttr(value, name);
    if (data !== undefined) {
      fields.push({
        type: value as ZType,
        key: key,
        data,
      });
    }
  }

  return fields;
};

/**
 * Type representation.
 */
export type PgAttr<T extends ZType, TAttr extends PgSymbolKeys> = T & {
  [K in TAttr]: PgSymbols[K];
};

export interface PgAttrField {
  key: string;
  type: ZType;
  data: any;
  nested?: any[];
  one?: boolean;
}

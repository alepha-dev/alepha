import type { ZObject, ZType } from "alepha";
import type { PgSymbolKeys, PgSymbols } from "../constants/PG_SYMBOLS.ts";

/**
 * Decorates a typebox schema with a Postgres attribute.
 *
 * > It's just a fancy way to add Symbols to a field.
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
  Object.assign(type, { [attr]: value ?? {} });
  return type as PgAttr<T, Attr>;
};

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
    if (name in value) {
      fields.push({
        type: value as ZType,
        key: key,
        data: (value as any)[name],
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

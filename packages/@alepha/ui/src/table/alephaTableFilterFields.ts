import { AlephaError, type ZObject, type ZType, z } from "alepha";

import { ALEPHA_TABLE_FILTER_OPERATORS } from "./AlephaTableFilterOperator.tsx";
import type {
  AlephaTableFilterField,
  AlephaTableFilterFields,
  AlephaTableFilterMode,
  AlephaTableFilterValues,
} from "./alephaTableTypes.ts";

/**
 * Every key a table's filters are stored, sent and linked under: each field's
 * own key, followed by its operator key when it has operators.
 *
 * One rule, read everywhere a filter key is enumerated: Reset, Share,
 * `fromQuery`, persistence, the dev warning on a key set that changed after
 * mount, and a page that derives a remount key from the keys its URL can
 * seed. Two copies of "`<key>Op` unless `operatorKey` says otherwise" is how
 * a Share link comes to drop an operator the fetch still reads.
 *
 * In declaration order.
 */
export const alephaTableFilterKeys = <F extends AlephaTableFilterFields>(
  fields: F,
): Array<keyof AlephaTableFilterValues<F> & string> => {
  const keys: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    keys.push(key);
    const operatorKey = alephaTableFilterOperatorKey(key, field);
    if (operatorKey) keys.push(operatorKey);
  }
  return keys as Array<keyof AlephaTableFilterValues<F> & string>;
};

/**
 * The key a field's operator is stored under, or `undefined` for a field
 * without operators.
 */
export const alephaTableFilterOperatorKey = (
  key: string,
  field: AlephaTableFilterField,
): string | undefined => {
  if (!field.operators) return undefined;
  return field.operatorKey ?? `${key}Op`;
};

/**
 * The values a field's operator accepts, the default first, or `undefined`
 * for a field without operators.
 */
export const alephaTableFilterOperatorValues = (
  field: AlephaTableFilterField,
): string[] | undefined => {
  const operators = field.operators;
  if (!operators) return undefined;
  if (typeof operators === "string") {
    return [...ALEPHA_TABLE_FILTER_OPERATORS[operators]];
  }
  return operators.map((operator) => operator.value);
};

/**
 * The mode a field starts in: its own, `"locked"` for the search preset, and
 * `"optional"` otherwise.
 */
export const alephaTableFilterMode = (
  field: AlephaTableFilterField,
): AlephaTableFilterMode =>
  field.mode ?? (field.preset === "search" ? "locked" : "optional");

/**
 * The schema a field is read with: its own, or the preset's.
 */
export const alephaTableFilterFieldSchema = (
  key: string,
  field: AlephaTableFilterField,
): ZType => {
  if (field.schema) return field.schema;
  if (field.preset === "search") return z.string();
  // The type refuses a field with neither; this is for a caller who reached
  // past it with a cast, and would otherwise get a filter nothing can decode.
  throw new AlephaError(
    `AlephaTable filter "${key}" has neither a schema nor a preset.`,
  );
};

/**
 * The `z.object` a table's filter form is built on, from its fields.
 *
 * Each field's schema is made optional here rather than at the call site:
 * every filter is optional by nature, and `.optional()` written sixty times
 * says nothing. A field with operators adds its operator key, an enum of the
 * operator values, so a value the switch never offers is refused by the same
 * decode that refuses a stale bookmark.
 *
 * Built once, at mount.
 */
export const buildAlephaTableFilterSchema = (
  fields: AlephaTableFilterFields,
): ZObject => {
  const shape: Record<string, ZType> = {};
  for (const [key, field] of Object.entries(fields)) {
    const schema = alephaTableFilterFieldSchema(key, field);
    shape[key] = z.schema.isOptional(schema) ? schema : schema.optional();
    const operatorKey = alephaTableFilterOperatorKey(key, field);
    const operatorValues = alephaTableFilterOperatorValues(field);
    if (operatorKey && operatorValues && operatorValues.length > 0) {
      shape[operatorKey] = z
        .enum(operatorValues as [string, ...string[]])
        .optional();
    }
  }
  return z.object(shape);
};

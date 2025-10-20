import { randomUUID } from "node:crypto";
import {
  type Static,
  type TObject,
  type TSchema,
  type TString,
  t,
} from "@alepha/core";
import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/sqlite-core";
import {
  PG_CREATED_AT,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_SERIAL,
  PG_UPDATED_AT,
} from "../constants/PG_SYMBOLS.ts";
import { camelToSnakeCase, type FromSchema } from "./schemaToPgColumns.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Proof of concept. Nothing serious.
 *
 * This function converts a Typebox schema to SQLite columns.
 */

// ---------------------------------------------------------------------------------------------------------------------

export const schemaToSqliteColumns = <T extends TObject>(
  schema: T,
): FromSchema<T> => {
  return Object.entries(schema.properties).reduce<Partial<FromSchema<T>>>(
    (columns, [key, value]) => {
      let col = mapFieldToSqliteColumn(key, value);

      if ("default" in value && value.default != null) {
        col = col.default(value.default as any);
      }

      if (PG_PRIMARY_KEY in value) {
        col = col.primaryKey();
      }

      if (PG_REF in value) {
        const config = value[PG_REF] as any;
        col = col.references(config.ref, config.actions);
      }

      if (schema.required?.includes(key)) {
        col = col.notNull();
      }

      return {
        ...columns,
        [key]: col,
      };
    },
    {},
  ) as FromSchema<T>;
};

/**
 * Map a Typebox field to a PG column.
 *
 * @param name The key of the field.
 * @param value The value of the field.
 * @returns The PG column.
 */
export const mapFieldToSqliteColumn = (name: string, value: TSchema) => {
  const key = camelToSnakeCase(name);

  if (
    // is nullish ?
    "anyOf" in value &&
    Array.isArray(value.anyOf) &&
    value.anyOf.length === 2 &&
    value.anyOf.some((it: TSchema) => t.schema.isNull(it))
  ) {
    // then, remove nullish
    value = value.anyOf.find((it: TSchema) => !t.schema.isNull(it))!;
  }

  if (t.schema.isInteger(value)) {
    if (PG_SERIAL in value || PG_IDENTITY in value) {
      return pg
        .integer(key, { mode: "number" })
        .primaryKey({ autoIncrement: true });
    }

    return pg.integer(key);
  }

  if (t.schema.isNumber(value)) {
    if (PG_IDENTITY in value) {
      return pg
        .integer(key, { mode: "number" })
        .primaryKey({ autoIncrement: true });
    }

    return pg.numeric(key);
  }

  if (t.schema.isDate(value)) {
    return sqliteDate(key, {});
  }

  if (t.schema.isString(value)) {
    return mapStringToSqliteColumn(key, value);
  }

  if (t.schema.isBoolean(value)) {
    return sqliteBool(key, value);
  }

  if (t.schema.isObject(value)) {
    return sqliteJson(key, value);
  }

  if (t.schema.isRecord(value)) {
    return sqliteJson(key, value);
  }

  if (t.schema.isArray(value)) {
    if (t.schema.isObject(value.items)) {
      return sqliteJson(key, value);
    }
    if (t.schema.isRecord(value.items)) {
      return sqliteJson(key, value);
    }
    if (t.schema.isString(value.items)) {
      return sqliteJson(key, value);
    }
    if (t.schema.isInteger(value.items)) {
      return sqliteJson(key, value);
    }
    if (t.schema.isNumber(value.items)) {
      return sqliteJson(key, value);
    }
    if (t.schema.isBoolean(value.items)) {
      return sqliteJson(key, value);
    }
  }

  if (t.schema.isUnsafe(value) && "type" in value && value.type === "string") {
    return mapStringToSqliteColumn(key, value as any);
  }

  throw new Error(
    `Unsupported schema type for ${name} as ${JSON.stringify(value)}`,
  );
};

/**
 * Map a string to a PG column.
 *
 * @param key The key of the field.
 * @param value The value of the field.
 */
export const mapStringToSqliteColumn = (key: string, value: TString) => {
  if (value.format === "uuid") {
    if (PG_PRIMARY_KEY in value) {
      return pg
        .text(key)
        .primaryKey()
        .$defaultFn(() => randomUUID());
    }

    return pg.text(key);
  }

  if (value.format === "byte") {
    return sqliteJson(key, value);
  }

  if (value.format === "date-time") {
    if (PG_CREATED_AT in value) {
      return sqliteDateTime(key, {}).default(sql`(unixepoch('subsec') * 1000)`);
    }
    if (PG_UPDATED_AT in value) {
      return sqliteDateTime(key, {}).default(sql`(unixepoch('subsec') * 1000)`);
    }
    return sqliteDateTime(key, {});
  }

  if (value.format === "date") {
    return sqliteDate(key, {});
  }

  return pg.text(key);
};

export const sqliteJson = <TDocument extends TSchema>(
  name: string,
  document: TDocument,
) =>
  pg
    .customType<{
      data: Static<TDocument>;
      driverData: string;
      config: { document: TDocument };
      configRequired: true;
    }>({
      dataType: () => "text",
      toDriver: (value) => JSON.stringify(value),
      fromDriver: (value: TDocument | string) => {
        return value && typeof value === "string" ? JSON.parse(value) : value;
      },
    })(name, { document })
    .$type<Static<TDocument>>();

export const sqliteDateTime = pg.customType<{
  data: string;
  driverData: number;
  configRequired: true;
}>({
  dataType: () => "integer",
  toDriver: (value) => new Date(value).getTime(),
  fromDriver: (value) => {
    return new Date(value).toISOString();
  },
});

export const sqliteDate = pg.customType<{
  data: string;
  driverData: number;
  configRequired: true;
}>({
  dataType: () => "integer",
  toDriver: (value) => new Date(value).getTime(),
  fromDriver: (value) => {
    return new Date(value).toISOString().split("T")[0];
  },
});

export const sqliteBool = pg.customType<{
  data: boolean;
  driverData: number;
  configRequired: true;
}>({
  dataType: () => "integer",
  toDriver: (value) => (value ? 1 : 0),
  fromDriver: (value) => value === 1,
});

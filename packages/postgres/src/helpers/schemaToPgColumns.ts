import { AlephaError, type TObject, type TSchema, t } from "@alepha/core";
import type { TableConfig } from "drizzle-orm";
import type {
  PgColumnBuilderBase,
  PgTableWithColumns,
} from "drizzle-orm/pg-core";
import * as pg from "drizzle-orm/pg-core";
import {
  PG_CREATED_AT,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_SERIAL,
  PG_UPDATED_AT,
  type PgIdentityOptions,
} from "../constants/PG_SYMBOLS.ts";
import type { TObjectInsert } from "../schemas/insertSchema.ts";
import type { TObjectUpdate } from "../schemas/updateSchema.ts";
import { byte } from "../types/byte.ts";
import { schema } from "../types/schema.ts";

/**
 * Convert a Typebox Schema to Drizzle ORM Postgres columns
 */
export const schemaToPgColumns = <T extends TObject>(
  schema: T,
): FromSchema<T> => {
  return Object.entries(schema.properties).reduce<Partial<FromSchema<T>>>(
    (columns, [key, value]) => {
      let col = mapFieldToColumn(key, value);

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
export const mapFieldToColumn = (name: string, value: TSchema) => {
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
    if (PG_SERIAL in value) {
      return pg.serial(key);
    }

    if (PG_IDENTITY in value) {
      const options = value[PG_IDENTITY] as PgIdentityOptions;
      if (options.mode === "byDefault") {
        return pg.integer().generatedByDefaultAsIdentity(options);
      }
      return pg.integer().generatedAlwaysAsIdentity(options);
    }

    return pg.integer(key);
  }

  if (t.schema.isBigInt(value)) {
    if (PG_IDENTITY in value) {
      const options = value[PG_IDENTITY] as PgIdentityOptions;
      if (options.mode === "byDefault") {
        return pg
          .bigint({ mode: "bigint" })
          .generatedByDefaultAsIdentity(options);
      }
      return pg.bigint({ mode: "bigint" }).generatedAlwaysAsIdentity(options);
    }
  }

  if (t.schema.isNumber(value)) {
    if (PG_IDENTITY in value) {
      const options = value[PG_IDENTITY] as PgIdentityOptions;
      if (options.mode === "byDefault") {
        return pg
          .bigint({ mode: "number" })
          .generatedByDefaultAsIdentity(options);
      }
      return pg.bigint({ mode: "number" }).generatedAlwaysAsIdentity(options);
    }

    if (value.format === "int64") {
      return pg.bigint(key, { mode: "number" });
    }

    return pg.numeric(key);
  }

  if (t.schema.isDate(value)) {
    return pg.date(key, { mode: "string" });
  }

  if (t.schema.isString(value)) {
    return mapStringToColumn(key, value);
  }

  if (t.schema.isBoolean(value)) {
    return pg.boolean(key);
  }

  if (t.schema.isObject(value)) {
    return schema(key, value);
  }

  if (t.schema.isRecord(value)) {
    return schema(key, value);
  }

  if (t.schema.isArray(value)) {
    if (t.schema.isObject(value.items)) {
      return schema(key, value);
    }
    if (t.schema.isRecord(value.items)) {
      return schema(key, value);
    }
    if (t.schema.isString(value.items)) {
      return pg.text(key).array();
    }
    if (t.schema.isInteger(value.items)) {
      return pg.integer(key).array();
    }
    if (t.schema.isNumber(value.items)) {
      return pg.numeric(key).array();
    }
    if (t.schema.isBoolean(value.items)) {
      return pg.boolean(key).array();
    }
  }

  if (t.schema.isUnsafe(value) && "type" in value && value.type === "string") {
    // t.enum()
    return mapStringToColumn(key, value);
  }

  throw new AlephaError(
    `Unsupported schema type for ${name} as ${JSON.stringify(value)}`,
  );
};

/**
 * Map a string to a PG column.
 *
 * @param key The key of the field.
 * @param value The value of the field.
 */
export const mapStringToColumn = (key: string, value: TSchema) => {
  if ("format" in value) {
    if (value.format === "uuid") {
      if (PG_PRIMARY_KEY in value) {
        return pg.uuid(key).defaultRandom();
      }

      return pg.uuid(key);
    }

    if (value.format === "byte") {
      return byte(key);
    }

    if (value.format === "date-time") {
      if (PG_CREATED_AT in value) {
        return pg
          .timestamp(key, { mode: "string", withTimezone: true })
          .defaultNow();
      }
      if (PG_UPDATED_AT in value) {
        return pg
          .timestamp(key, { mode: "string", withTimezone: true })
          .defaultNow();
      }
      return pg.timestamp(key, { mode: "string", withTimezone: true });
    }

    if (value.format === "date") {
      return pg.date(key, { mode: "string" });
    }
  }

  return pg.text(key);
};

export const camelToSnakeCase = (str: string) => {
  return (
    str[0].toLowerCase() +
    str.slice(1).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
  );
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Convert a schema to columns.
 */
export type FromSchema<T extends TObject> = {
  [key in keyof T["properties"]]: PgColumnBuilderBase;
};

/**
 * A table with columns and schema.
 */
export type PgTableWithColumnsAndSchema<
  T extends TableConfig,
  R extends TObject,
> = PgTableWithColumns<T> & {
  get $table(): PgTableWithColumns<T>;
  get $schema(): R;
  get $insertSchema(): TObjectInsert<R>;
  get $updateSchema(): TObjectUpdate<R>;
};

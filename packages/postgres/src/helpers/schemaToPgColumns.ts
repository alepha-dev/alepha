import { AlephaError, type TObject, type TSchema, t } from "@alepha/core";
import type { PgIntColumnBaseBuilder } from "drizzle-orm/pg-core";
import * as pg from "drizzle-orm/pg-core";
import { type PgColumnBuilderBase, pgEnum } from "drizzle-orm/pg-core";
import {
  PG_CREATED_AT,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_SERIAL,
  PG_UPDATED_AT,
  type PgIdentityOptions,
} from "../constants/PG_SYMBOLS.ts";
import { byte } from "../types/byte.ts";
import { schema } from "../types/schema.ts";

/**
 * Configuration options for schema to PG columns conversion
 */
export interface SchemaToPgColumnsConfig {
  /**
   * Custom naming strategy for converting field names to column names
   * @default camelToSnakeCase
   */
  namingStrategy: (fieldName: string) => string;
  /**
   * Custom type mappers for specific schema types
   */
  customTypeMappers: {
    [key: string]: (
      key: string,
      value: TSchema,
      registry: Map<string, any>,
    ) => PgIntColumnBaseBuilder<any>;
  };
}

/**
 * Default configuration for schema to PG columns conversion
 */
export const pgColumnsConfig: SchemaToPgColumnsConfig = {
  namingStrategy: camelToSnakeCase,
  customTypeMappers: {},
};

/**
 * Convert a Typebox Schema to Drizzle ORM Postgres columns
 */
export const schemaToPgColumns = <T extends TObject>(
  schema: T,
  registry: Map<string, any>,
): FromSchema<T> => {
  return Object.entries(schema.properties).reduce<Partial<FromSchema<T>>>(
    (columns, [key, value]) => {
      let col = mapFieldToColumn(key, value, registry);

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
 */
export const mapFieldToColumn = (
  name: string,
  value: TSchema,
  registry: Map<string, any>,
) => {
  const key = pgColumnsConfig.namingStrategy(name);

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

  for (const customTypeName in pgColumnsConfig.customTypeMappers) {
    const col = pgColumnsConfig.customTypeMappers[customTypeName](
      key,
      value,
      registry,
    );
    if (col) {
      return col;
    }
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

  if (
    t.schema.isUnsafe(value) &&
    "type" in value &&
    value.type === "string" &&
    "enum" in value &&
    Array.isArray(value.enum)
  ) {
    if (!value.enum.every((it) => typeof it === "string")) {
      throw new AlephaError(
        `Enum for ${name} must be an array of strings, got ${JSON.stringify(
          value.enum,
        )}`,
      );
    }

    // if the enum has a title, we can create a real PG enum type
    if ("title" in value && typeof value.title === "string") {
      const enumName = value.title;
      if (!registry.has(enumName)) {
        registry.set(enumName, pgEnum(enumName, value.enum as [string]));
      }
      return registry.get(enumName)(key);
    }

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

export function camelToSnakeCase(str: string) {
  return (
    str[0].toLowerCase() +
    str.slice(1).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
  );
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Convert a schema to columns.
 */
export type FromSchema<T extends TObject> = {
  [key in keyof T["properties"]]: PgColumnBuilderBase;
};

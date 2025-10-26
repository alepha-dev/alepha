import { AlephaError, type TObject, type TSchema, t } from "@alepha/core";
import * as pg from "drizzle-orm/pg-core";
import {
  type PgEnum,
  type PgSchema,
  type PgTableWithColumns,
  pgEnum,
  pgSchema,
  pgTable,
} from "drizzle-orm/pg-core";
import {
  PG_CREATED_AT,
  PG_ENUM,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_SERIAL,
  PG_UPDATED_AT,
  type PgEnumOptions,
  type PgIdentityOptions,
  type PgRefOptions,
} from "../constants/PG_SYMBOLS.ts";
import type { EntityDescriptor, FromSchema } from "../descriptors/$entity.ts";
import type { SequenceDescriptor } from "../descriptors/$sequence.ts";
import { byte } from "../types/byte.ts";
import { schema } from "../types/schema.ts";
import type { ModelBuilder } from "./ModelBuilder.ts";

export class PostgresModelBuilder implements ModelBuilder {
  protected schemas = new Map<string, PgSchema>();

  protected getPgSchema(name: string) {
    if (!this.schemas.has(name) && name !== "public") {
      this.schemas.set(name, pgSchema(name));
    }

    const nsp =
      name !== "public"
        ? this.schemas.get(name)
        : ({
            enum: pgEnum,
            table: pgTable,
          } as any);

    if (!nsp) {
      throw new AlephaError(`Postgres schema ${name} not found`);
    }

    return nsp;
  }

  public buildTable(
    entity: EntityDescriptor<TObject>,
    options: {
      tables: Map<string, unknown>;
      enums: Map<string, unknown>;
      schema: string;
    },
  ) {
    const tableName = entity.name;
    if (options.tables.has(tableName)) {
      return;
    }

    const nsp = this.getPgSchema(options.schema);

    options.tables.set(
      tableName,
      nsp.table(
        tableName,
        this.schemaToPgColumns(
          tableName,
          entity.schema,
          nsp,
          options.enums,
          options.tables,
        ),
        entity.options.config,
      ),
    );
  }

  public buildSequence(
    sequence: SequenceDescriptor,
    options: {
      sequences: Map<string, unknown>;
      schema: string;
    },
  ) {
    const sequenceName = sequence.name;
    if (options.sequences.has(sequenceName)) {
      return;
    }

    const nsp = this.getPgSchema(options.schema);

    options.sequences.set(
      sequenceName,
      nsp.sequence(sequenceName, sequence.options),
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  toColumnName(str: string) {
    return (
      str[0].toLowerCase() +
      str.slice(1).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    );
  }

  schemaToPgColumns = <T extends TObject>(
    tableName: string,
    schema: T,
    nsp: PgSchema,
    enums: Map<string, unknown>,
    tables: Map<string, unknown>,
  ): FromSchema<T> => {
    return Object.entries(schema.properties).reduce<Partial<FromSchema<T>>>(
      (columns, [key, value]) => {
        let col = this.mapFieldToColumn(tableName, key, value, nsp, enums);

        if ("default" in value && value.default != null) {
          col = col.default(value.default as any);
        }

        if (PG_PRIMARY_KEY in value) {
          col = col.primaryKey();
        }

        if (PG_REF in value) {
          const config = value[PG_REF] as PgRefOptions;
          col = col.references(() => {
            const ref = config.ref();
            const table = tables.get(
              ref.entity.name,
            ) as PgTableWithColumns<any>;

            if (!table) {
              throw new AlephaError(
                `Referenced table ${ref.entity.name} not found for ${tableName}.${key}`,
              );
            }

            const target = table[ref.name];
            if (!target) {
              throw new AlephaError(
                `Referenced column ${ref.name} not found in table ${ref.entity.name} for ${tableName}.${key}`,
              );
            }

            return target;
          }, config.actions);
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

  mapFieldToColumn = (
    tableName: string,
    fieldName: string,
    value: TSchema,
    nsp: PgSchema,
    enums: Map<string, any>,
  ) => {
    const key = this.toColumnName(fieldName);

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
      return this.mapStringToColumn(key, value);
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

    // Enum handling
    if (
      t.schema.isUnsafe(value) &&
      "type" in value &&
      value.type === "string" &&
      "enum" in value &&
      Array.isArray(value.enum)
    ) {
      if (!value.enum.every((it) => typeof it === "string")) {
        throw new AlephaError(
          `Enum for ${fieldName} must be an array of strings, got ${JSON.stringify(
            value.enum,
          )}`,
        );
      }

      // SQL Enum
      if (PG_ENUM in value && value[PG_ENUM]) {
        const options = value[PG_ENUM] as PgEnumOptions;
        const enumName = options.name ?? `${tableName}_${key}_enum`;

        if (enums.has(enumName)) {
          const values = (
            enums.get(enumName) as PgEnum<[string]>
          ).enumValues.join(",");
          const newValues = value.enum.join(",");
          if (values !== newValues) {
            throw new AlephaError(
              `Enum name conflict for ${enumName}: [${values}] vs [${newValues}]`,
            );
          }
        }

        enums.set(enumName, nsp.enum(enumName, value.enum as [string]));

        return enums.get(enumName)(key);
      }

      // else, map to TEXT
      return this.mapStringToColumn(key, value);
    }

    throw new AlephaError(
      `Unsupported schema type for ${fieldName} as ${JSON.stringify(value)}`,
    );
  };

  /**
   * Map a string to a PG column.
   *
   * @param key The key of the field.
   * @param value The value of the field.
   */
  mapStringToColumn = (key: string, value: TSchema) => {
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
}

import { AlephaError, type ZObject, z } from "alepha";
import {
  type EntityPrimitive,
  type FromSchema,
  ModelBuilder,
  PG_CREATED_AT,
  PG_GENERATED,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_UPDATED_AT,
  type PgGeneratedOptions,
  type PgIdentityOptions,
  type PgRefOptions,
  type SequencePrimitive,
  schema,
  sql,
} from "alepha/orm";
import type { BuildExtraConfigColumns } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import {
  check,
  foreignKey,
  index,
  type PgEnum,
  type PgSchema,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  pgEnum,
  pgSchema,
  pgSequence,
  pgTable,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { byte } from "../types/byte.ts";

export class PostgresModelBuilder extends ModelBuilder {
  protected schemas = new Map<string, PgSchema>();

  /**
   * Create a primary key column with UUID v7
   */
  protected getPrimaryKeyUUID(key: string) {
    return pg.uuid(key).default(sql`uuidv7()`);
  }

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
            sequence: pgSequence,
          } as any);

    if (!nsp) {
      throw new AlephaError(`Postgres schema ${name} not found`);
    }

    return nsp;
  }

  public buildTable(
    entity: EntityPrimitive<any>,
    options: {
      tables: Map<string, unknown>;
      enums: Map<string, unknown>;
      schemas: Map<string, unknown>;
      schema: string;
    },
  ) {
    const tableName = entity.name;
    if (options.tables.has(tableName)) {
      return;
    }

    const nsp = this.getPgSchema(options.schema);

    // Register PgSchema so drizzle-kit knows the schema is declared in code.
    // Without this, pushSchema diffs "schema exists in DB but not in code" → DROP.
    if (options.schema !== "public" && !options.schemas.has(options.schema)) {
      options.schemas.set(options.schema, nsp);
    }

    const columns = this.schemaToPgColumns(
      tableName,
      entity.schema,
      nsp,
      options.enums,
      options.tables,
    );

    // Build the config function that includes indexes, foreign keys, constraints, and custom config
    const configFn = this.getTableConfig(entity, options.tables);

    const table = nsp.table(tableName, columns, configFn);

    options.tables.set(tableName, table);
  }

  public buildSequence(
    sequence: SequencePrimitive,
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

  /**
   * Get PostgreSQL-specific config builder for the table.
   */
  protected getTableConfig(
    entity: EntityPrimitive,
    tables: Map<string, unknown>,
  ):
    | ((
        self: BuildExtraConfigColumns<string, any, "pg">,
      ) => PgTableExtraConfigValue[])
    | undefined {
    // PostgreSQL-specific builders
    const pgBuilders = {
      index,
      uniqueIndex,
      unique,
      check,
      foreignKey,
    };

    // Table resolver function
    const tableResolver = (entityName: string) => {
      return tables.get(entityName) as any;
    };

    return this.buildTableConfig<
      PgTableExtraConfigValue,
      BuildExtraConfigColumns<string, any, "pg">
    >(entity, pgBuilders as any, tableResolver);
  }

  schemaToPgColumns = <T extends ZObject>(
    tableName: string,
    schema: T,
    nsp: PgSchema,
    enums: Map<string, unknown>,
    tables: Map<string, unknown>,
  ): FromSchema<T> => {
    return Object.entries(z.schema.shape(schema)).reduce<
      Partial<FromSchema<T>>
    >((columns, [key, value]) => {
      let col = this.mapFieldToColumn(tableName, key, value, nsp, enums);

      const defaultValue = z.schema.getDefault(value);
      if (defaultValue != null) {
        col = col.default(defaultValue as any);
      }

      if (PG_PRIMARY_KEY in value) {
        col = col.primaryKey();
      }

      if (PG_REF in value) {
        const config = value[PG_REF] as PgRefOptions;
        col = col.references(() => {
          const ref = config.ref();
          const table = tables.get(ref.entity.name) as PgTableWithColumns<any>;

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

      if (PG_GENERATED in value) {
        const gen = value[PG_GENERATED] as PgGeneratedOptions;
        col = col.generatedAlwaysAs(gen.expression);
      }

      if (z.schema.requiredKeys(schema).includes(key)) {
        col = col.notNull();
      }

      (columns as Record<string, unknown>)[key] = col;
      return columns;
    }, {}) as FromSchema<T>;
  };

  mapFieldToColumn = (
    tableName: string,
    fieldName: string,
    value: any,
    nsp: PgSchema,
    enums: Map<string, any>,
  ) => {
    const key = this.toColumnName(fieldName);

    // Peel optional / nullable / default wrappers to the underlying type.
    value = z.schema.unwrap(value);

    // `z.int64()` is a safe-integer with format "int64" → Postgres bigint
    // (stored as a JS number). Must be checked before the plain-integer branch
    // below, otherwise it maps to int4 and overflows past 2_147_483_647.
    if (z.schema.isInteger(value) && z.schema.format(value) === "int64") {
      if (PG_IDENTITY in value) {
        const options = value[PG_IDENTITY] as PgIdentityOptions;
        if (options.mode === "byDefault") {
          return pg
            .bigint(key, { mode: "number" })
            .generatedByDefaultAsIdentity(options);
        }
        return pg
          .bigint(key, { mode: "number" })
          .generatedAlwaysAsIdentity(options);
      }
      return pg.bigint(key, { mode: "number" });
    }

    if (z.schema.isInteger(value)) {
      if (PG_IDENTITY in value) {
        const options = value[PG_IDENTITY] as PgIdentityOptions;
        if (options.mode === "byDefault") {
          return pg.integer(key).generatedByDefaultAsIdentity(options);
        }
        return pg.integer(key).generatedAlwaysAsIdentity(options);
      }

      return pg.integer(key);
    }

    if (z.schema.isBigInt(value)) {
      if (PG_IDENTITY in value) {
        const options = value[PG_IDENTITY] as PgIdentityOptions;
        if (options.mode === "byDefault") {
          return pg
            .bigint(key, { mode: "bigint" })
            .generatedByDefaultAsIdentity(options);
        }
        return pg
          .bigint(key, { mode: "bigint" })
          .generatedAlwaysAsIdentity(options);
      }

      return pg.bigint(key, { mode: "bigint" });
    }

    if (z.schema.isNumber(value)) {
      if (PG_IDENTITY in value) {
        const options = value[PG_IDENTITY] as PgIdentityOptions;
        if (options.mode === "byDefault") {
          return pg
            .bigint(key, { mode: "number" })
            .generatedByDefaultAsIdentity(options);
        }
        return pg
          .bigint(key, { mode: "number" })
          .generatedAlwaysAsIdentity(options);
      }

      if (z.schema.format(value) === "int64") {
        return pg.bigint(key, { mode: "number" });
      }

      // Native float column — drizzle returns a JS number. `numeric` would
      // hand back a string, which strict `z.number()` validation rejects.
      return pg.doublePrecision(key);
    }

    if (z.schema.isString(value) && !z.schema.isEnum(value)) {
      return this.mapStringToColumn(key, value);
    }

    if (z.schema.isBoolean(value)) {
      return pg.boolean(key);
    }

    if (z.schema.isObject(value)) {
      return schema(key, value);
    }

    if (z.schema.isRecord(value)) {
      return schema(key, value);
    }

    // jsonb, matching SqliteModelBuilder's JSON mapping. Without this branch
    // an entity that builds fine on the sqlite dev driver threw "Unsupported
    // schema type" at startup on a postgres deploy.
    if (z.schema.isAny(value)) {
      return schema(key, value);
    }

    if (z.schema.isArray(value)) {
      const items = z.schema.element(value);
      if (z.schema.isObject(items)) {
        return schema(key, value);
      }
      if (z.schema.isRecord(items)) {
        return schema(key, value);
      }
      if (z.schema.isAny(items)) {
        return schema(key, value);
      }
      if (z.schema.isString(items)) {
        return pg.text(key).array();
      }
      if (z.schema.isInteger(items)) {
        return pg.integer(key).array();
      }
      if (z.schema.isNumber(items)) {
        // doublePrecision returns JS numbers; `numeric` hands back strings,
        // which strict `z.number()` element validation rejects (mirrors the
        // scalar-number column choice above).
        return pg.doublePrecision(key).array();
      }
      if (z.schema.isBoolean(items)) {
        return pg.boolean(key).array();
      }
      if (z.schema.isEnum(items)) {
        return pg.text(key).array();
      }
    }

    // Enum handling
    if (z.schema.isEnum(value)) {
      const enumVals = z.schema.enumValues(value);
      if (!enumVals.every((it) => typeof it === "string")) {
        throw new AlephaError(
          `Enum for ${fieldName} must be an array of strings, got ${JSON.stringify(
            enumVals,
          )}`,
        );
      }

      const enumMeta = (value.meta?.() ?? {}) as {
        mode?: string;
        name?: string;
      };

      // SQL Enum (default for z.enum unless mode: "text", which asks for a
      // plain TEXT column instead). `name` overrides the generated type name
      // so several tables can share one PG ENUM type — the conflict check
      // below is what makes that sharing safe.
      if (enumMeta.mode !== "text") {
        const enumName = enumMeta.name ?? `${tableName}_${key}_enum`;

        if (enums.has(enumName)) {
          const values = (
            enums.get(enumName) as PgEnum<[string]>
          ).enumValues.join(",");
          const newValues = enumVals.join(",");
          if (values !== newValues) {
            throw new AlephaError(
              `Enum name conflict for ${enumName}: [${values}] vs [${newValues}]`,
            );
          }
        }

        enums.set(enumName, nsp.enum(enumName, enumVals as [string]));

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
  mapStringToColumn = (key: string, value: any) => {
    const format = z.schema.format(value);

    if (format === "uuid") {
      if (PG_PRIMARY_KEY in value) {
        return this.getPrimaryKeyUUID(key);
      }

      return pg.uuid(key);
    }

    if (format === "binary") {
      return byte(key);
    }

    if (format === "date-time") {
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

    if (format === "date") {
      return pg.date(key, { mode: "string" });
    }

    return pg.text(key);
  };
}

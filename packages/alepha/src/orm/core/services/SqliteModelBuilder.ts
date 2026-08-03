import { randomUUID } from "node:crypto";
import { AlephaError, type Infer, type ZObject, type ZType, z } from "alepha";
import { type BuildColumns, sql } from "drizzle-orm";
import * as pg from "drizzle-orm/sqlite-core";
import {
  check,
  foreignKey,
  index,
  type SQLiteColumnBuilder,
  type SQLiteTableWithColumns,
  sqliteTable,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  PG_CREATED_AT,
  PG_GENERATED,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_UPDATED_AT,
  type PgGeneratedOptions,
  type PgRefOptions,
} from "../constants/PG_SYMBOLS.ts";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type { SequencePrimitive } from "../primitives/$sequence.ts";
import { ModelBuilder, type TableConfigBuilders } from "./ModelBuilder.ts";

export class SqliteModelBuilder extends ModelBuilder {
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

    const columns = this.schemaToSqliteColumns(
      tableName,
      entity.schema,
      options.enums,
      options.tables,
    );

    // Build the config function for SQLite
    const configFn = this.getTableConfig(entity, options.tables);

    const table = sqliteTable(tableName, columns, configFn);

    options.tables.set(tableName, table);
  }

  public buildSequence(
    sequence: SequencePrimitive,
    options: {
      sequences: Map<string, unknown>;
      schema: string;
    },
  ) {
    throw new AlephaError("SQLite does not support sequences");
  }

  /**
   * Get SQLite-specific config builder for the table.
   */
  protected getTableConfig(
    entity: EntityPrimitive,
    tables: Map<string, unknown>,
  ): ((self: BuildColumns<string, any, "sqlite">) => any) | undefined {
    // SQLite-specific builders
    const sqliteBuilders = {
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

    return this.buildTableConfig<any, BuildColumns<string, any, "sqlite">>(
      entity,
      // drizzle-orm v1's `foreignKey()` requires `columns`/`foreignColumns`
      // to be non-empty tuples ([AnySQLiteColumn, ...]); `TableConfigBuilders`
      // types them as `any[]` to stay dialect-agnostic across pg/sqlite.
      // `ModelBuilder.buildTableConfig` never calls `foreignKey()` with an
      // empty array (see its `foreignKeys` loop), so this narrows safely.
      sqliteBuilders as TableConfigBuilders<any>,
      tableResolver,
      (config, self) => {
        // SQLite custom config handler
        const customConfigs = (config as any)(self);
        return Array.isArray(customConfigs) ? customConfigs : [];
      },
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  schemaToSqliteColumns = <T extends ZObject>(
    tableName: string,
    schema: T,
    enums: Map<string, unknown>,
    tables: Map<string, unknown>,
  ): SchemaToSqliteBuilder<T> => {
    return Object.entries(z.schema.shape(schema)).reduce<
      Partial<SchemaToSqliteBuilder<T>>
    >((columns, [key, value]) => {
      let col = this.mapFieldToSqliteColumn(tableName, key, value, enums);

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
          const table = tables.get(
            ref.entity.name,
          ) as SQLiteTableWithColumns<any>;

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
        col = col.generatedAlwaysAs(gen.expression, {
          mode: gen.mode ?? "virtual",
        });
      }

      if (z.schema.requiredKeys(schema).includes(key)) {
        col = col.notNull();
      }

      (columns as Record<string, unknown>)[key] = col;
      return columns;
    }, {}) as SchemaToSqliteBuilder<T>;
  };

  mapFieldToSqliteColumn = (
    tableName: string,
    fieldName: string,
    value: any,
    enums: Map<string, any>,
  ) => {
    const key = this.toColumnName(fieldName);

    // Peel optional / nullable / default wrappers to the underlying type.
    value = z.schema.unwrap(value);

    if (z.schema.isInteger(value)) {
      if (PG_IDENTITY in value) {
        return pg
          .integer(key, { mode: "number" })
          .primaryKey({ autoIncrement: true });
      }

      return pg.integer(key);
    }

    if (z.schema.isBigInt(value)) {
      if (PG_PRIMARY_KEY in value || PG_IDENTITY in value) {
        // Auto-increment rowid — must stay INTEGER; sequential ids won't
        // reach 2^53 in practice.
        return pg
          .integer(key, { mode: "number" })
          .primaryKey({ autoIncrement: true });
      }

      // Non-key 64-bit values (snowflakes, external ids) exceed JS number
      // precision — SQLite drivers hand integers back as numbers, silently
      // corrupting anything beyond 2^53. The app-level type is a string
      // anyway, so store TEXT for an exact round-trip (matches Postgres).
      return pg.text(key);
    }

    if (z.schema.isNumber(value)) {
      if (PG_IDENTITY in value) {
        return pg
          .integer(key, { mode: "number" })
          .primaryKey({ autoIncrement: true });
      }

      // Native real column — returns a JS number (sqlite `numeric` yields a
      // string, which strict `z.number()` validation rejects).
      return pg.real(key);
    }

    if (z.schema.isString(value)) {
      return this.mapStringToSqliteColumn(key, value);
    }

    if (z.schema.isBoolean(value)) {
      return this.sqliteBool(key, value);
    }

    if (z.schema.isObject(value)) {
      return this.sqliteJson(key, value);
    }

    if (z.schema.isRecord(value)) {
      return this.sqliteJson(key, value);
    }

    if (z.schema.isAny(value)) {
      return this.sqliteJson(key, value);
    }

    if (z.schema.isArray(value)) {
      if (z.schema.isObject(z.schema.element(value))) {
        return this.sqliteJson(key, value);
      }
      if (z.schema.isRecord(z.schema.element(value))) {
        return this.sqliteJson(key, value);
      }
      if (z.schema.isAny(z.schema.element(value))) {
        return this.sqliteJson(key, value);
      }
      if (z.schema.isString(z.schema.element(value))) {
        return this.sqliteJson(key, value);
      }
      if (z.schema.isInteger(z.schema.element(value))) {
        return this.sqliteJson(key, value);
      }
      if (z.schema.isNumber(z.schema.element(value))) {
        return this.sqliteJson(key, value);
      }
      if (z.schema.isBoolean(z.schema.element(value))) {
        return this.sqliteJson(key, value);
      }
      if (z.schema.isEnum(z.schema.element(value))) {
        return this.sqliteJson(key, value);
      }
    }

    if (z.schema.isEnum(value)) {
      return this.mapStringToSqliteColumn(key, value);
    }

    throw new AlephaError(
      `Unsupported schema for field '${tableName}.${fieldName}' (schema: ${JSON.stringify(value)})`,
    );
  };

  mapStringToSqliteColumn = (key: string, value: any) => {
    if (z.schema.format(value) === "uuid") {
      if (PG_PRIMARY_KEY in value) {
        return pg
          .text(key)
          .primaryKey()
          .$defaultFn(() => randomUUID());
      }

      return pg.text(key);
    }

    if (z.schema.format(value) === "binary") {
      return this.sqliteJson(key, value);
    }

    if (z.schema.format(value) === "date-time") {
      if (PG_CREATED_AT in value) {
        return this.sqliteDateTime(key, {}).default(
          sql`(unixepoch('subsec') * 1000)`,
        );
      }
      if (PG_UPDATED_AT in value) {
        return this.sqliteDateTime(key, {}).default(
          sql`(unixepoch('subsec') * 1000)`,
        );
      }
      return this.sqliteDateTime(key, {});
    }

    if (z.schema.format(value) === "date") {
      return this.sqliteDate(key, {});
    }

    return pg.text(key);
  };

  sqliteJson = <TDocument extends ZType>(name: string, document: TDocument) =>
    pg
      .customType<{
        data: Infer<TDocument>;
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
      .$type<Infer<TDocument>>();

  sqliteDateTime = pg.customType<{
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

  sqliteBool = pg.customType<{
    data: boolean;
    driverData: number;
    configRequired: true;
  }>({
    dataType: () => "integer",
    toDriver: (value) => (value ? 1 : 0),
    fromDriver: (value) => value === 1,
  });

  sqliteDate = pg.customType<{
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
}

export type SchemaToSqliteBuilder<T extends ZObject> = {
  [key in keyof T["shape"]]: SQLiteColumnBuilder;
};

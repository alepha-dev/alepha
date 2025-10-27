import { randomUUID } from "node:crypto";
import {
  AlephaError,
  type Static,
  type TObject,
  type TSchema,
  type TString,
  t,
} from "@alepha/core";
import { type BuildColumns, sql } from "drizzle-orm";
import * as pg from "drizzle-orm/sqlite-core";
import {
  check,
  foreignKey,
  index,
  type SQLiteColumnBuilderBase,
  type SQLiteTableWithColumns,
  sqliteTable,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  PG_CREATED_AT,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_SERIAL,
  PG_UPDATED_AT,
  type PgRefOptions,
} from "../constants/PG_SYMBOLS.ts";
import type { EntityDescriptor } from "../descriptors/$entity.ts";
import type { SequenceDescriptor } from "../descriptors/$sequence.ts";
import { ModelBuilder } from "./ModelBuilder.ts";

export class SqliteModelBuilder extends ModelBuilder {
  public buildTable(
    entity: EntityDescriptor<any>,
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
    sequence: SequenceDescriptor,
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
    entity: EntityDescriptor,
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
      sqliteBuilders,
      tableResolver,
      (config, self) => {
        // SQLite custom config handler
        const customConfigs = (config as any)(self);
        return Array.isArray(customConfigs) ? customConfigs : [];
      },
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  schemaToSqliteColumns = <T extends TObject>(
    tableName: string,
    schema: T,
    enums: Map<string, unknown>,
    tables: Map<string, unknown>,
  ): SchemaToSqliteBuilder<T> => {
    return Object.entries(schema.properties).reduce<
      Partial<SchemaToSqliteBuilder<T>>
    >((columns, [key, value]) => {
      let col = this.mapFieldToSqliteColumn(tableName, key, value, enums);

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

      if (schema.required?.includes(key)) {
        col = col.notNull();
      }

      return {
        ...columns,
        [key]: col,
      };
    }, {}) as SchemaToSqliteBuilder<T>;
  };

  mapFieldToSqliteColumn = (
    tableName: string,
    fieldName: string,
    value: TSchema,
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

    if (t.schema.isString(value)) {
      return this.mapStringToSqliteColumn(key, value);
    }

    if (t.schema.isBoolean(value)) {
      return this.sqliteBool(key, value);
    }

    if (t.schema.isObject(value)) {
      return this.sqliteJson(key, value);
    }

    if (t.schema.isRecord(value)) {
      return this.sqliteJson(key, value);
    }

    if (t.schema.isArray(value)) {
      if (t.schema.isObject(value.items)) {
        return this.sqliteJson(key, value);
      }
      if (t.schema.isRecord(value.items)) {
        return this.sqliteJson(key, value);
      }
      if (t.schema.isString(value.items)) {
        return this.sqliteJson(key, value);
      }
      if (t.schema.isInteger(value.items)) {
        return this.sqliteJson(key, value);
      }
      if (t.schema.isNumber(value.items)) {
        return this.sqliteJson(key, value);
      }
      if (t.schema.isBoolean(value.items)) {
        return this.sqliteJson(key, value);
      }
    }

    if (
      t.schema.isUnsafe(value) &&
      "type" in value &&
      value.type === "string"
    ) {
      return this.mapStringToSqliteColumn(key, value as any);
    }

    throw new Error(
      `Unsupported schema type for ${fieldName} as ${JSON.stringify(value)}`,
    );
  };

  mapStringToSqliteColumn = (key: string, value: TString) => {
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
      return this.sqliteJson(key, value);
    }

    if (value.format === "date-time") {
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

    if (value.format === "date") {
      return this.sqliteDate(key, {});
    }

    return pg.text(key);
  };

  sqliteJson = <TDocument extends TSchema>(name: string, document: TDocument) =>
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

export type SchemaToSqliteBuilder<T extends TObject> = {
  [key in keyof T["properties"]]: SQLiteColumnBuilderBase;
};

import { AlephaError } from "alepha";
import type { SQL } from "drizzle-orm";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type { SequencePrimitive } from "../primitives/$sequence.ts";
import type { ViewPrimitive } from "../primitives/$view.ts";

/**
 * Database-specific table configuration functions
 */
export interface TableConfigBuilders<TConfig> {
  index: (name: string) => {
    on: (...columns: any[]) => TConfig;
  };
  uniqueIndex: (name: string) => {
    on: (...columns: any[]) => TConfig;
  };
  unique: (name: string) => {
    on: (...columns: any[]) => TConfig;
  };
  check: (name: string, sql: SQL) => TConfig;
  foreignKey: (config: {
    name: string;
    columns: any[];
    foreignColumns: any[];
  }) => TConfig;
}

/**
 * Abstract base class for transforming Alepha Primitives (Entity, Sequence, etc...)
 * into drizzle models (tables, enums, sequences, etc...).
 */
export abstract class ModelBuilder {
  /**
   * Build a table from an entity primitive.
   */
  abstract buildTable(
    entity: EntityPrimitive,
    options: {
      tables: Map<string, unknown>;
      enums: Map<string, unknown>;
      schemas: Map<string, unknown>;
      schema: string;
    },
  ): void;

  /**
   * Build a view from a view primitive.
   */
  abstract buildView(
    view: ViewPrimitive,
    options: {
      tables: Map<string, unknown>;
      schema: string;
    },
  ): void;

  /**
   * Build a sequence from a sequence primitive.
   */
  abstract buildSequence(
    sequence: SequencePrimitive,
    options: {
      sequences: Map<string, unknown>;
      schema: string;
    },
  ): void;

  /**
   * Convert camelCase to snake_case for column names.
   */
  protected toColumnName(str: string): string {
    return (
      str[0].toLowerCase() +
      str.slice(1).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    );
  }

  /**
   * Build the table configuration function for any database.
   * This includes indexes, foreign keys, constraints, and custom config.
   *
   * @param entity - The entity primitive
   * @param builders - Database-specific builder functions
   * @param tableResolver - Function to resolve entity references to table columns
   * @param customConfigHandler - Optional handler for custom config
   */
  protected buildTableConfig<TConfig, TSelf>(
    entity: EntityPrimitive,
    builders: TableConfigBuilders<TConfig>,
    tableResolver?: (entityName: string) => any,
    customConfigHandler?: (config: any, self: TSelf) => TConfig[],
  ): ((self: TSelf) => TConfig[]) | undefined {
    // If no extra config is needed, return undefined
    if (
      !entity.options.indexes &&
      !entity.options.foreignKeys &&
      !entity.options.constraints &&
      !entity.options.config
    ) {
      return undefined;
    }

    return (self: TSelf) => {
      const configs: TConfig[] = [];

      // Build indexes
      if (entity.options.indexes) {
        for (const indexDef of entity.options.indexes) {
          if (typeof indexDef === "string") {
            const columnName = this.toColumnName(indexDef);
            const indexName = `${entity.name}_${columnName}_idx`;

            // Use original camelCase property name for lookup
            if ((self as any)[indexDef]) {
              configs.push(
                builders.index(indexName).on((self as any)[indexDef]),
              );
            }
          } else if (typeof indexDef === "object" && indexDef !== null) {
            if ("column" in indexDef) {
              const columnName = this.toColumnName(indexDef.column as string);
              const indexName =
                indexDef.name || `${entity.name}_${columnName}_idx`;

              // Use original camelCase property name for lookup
              if ((self as any)[indexDef.column]) {
                let idx = indexDef.unique
                  ? builders
                      .uniqueIndex(indexName)
                      .on((self as any)[indexDef.column])
                  : builders
                      .index(indexName)
                      .on((self as any)[indexDef.column]);
                if ("where" in indexDef && indexDef.where) {
                  idx = (idx as any).where(indexDef.where);
                }
                configs.push(idx);
              }
            } else if ("expressions" in indexDef) {
              const parts = indexDef.expressions(self as any);
              if (parts.length > 0) {
                let idx = indexDef.unique
                  ? builders.uniqueIndex(indexDef.name).on(...parts)
                  : builders.index(indexDef.name).on(...parts);
                if ("where" in indexDef && indexDef.where) {
                  idx = (idx as any).where(indexDef.where);
                }
                configs.push(idx);
              }
            } else if ("columns" in indexDef) {
              const columnNames = indexDef.columns.map((col: any) =>
                this.toColumnName(col as string),
              );
              const indexName =
                indexDef.name || `${entity.name}_${columnNames.join("_")}_idx`;

              // Use original camelCase property names for lookup
              const cols = indexDef.columns
                .map((col: any) => (self as any)[col])
                .filter(Boolean);

              if (cols.length === indexDef.columns.length) {
                let idx = indexDef.unique
                  ? builders.uniqueIndex(indexName).on(...cols)
                  : builders.index(indexName).on(...cols);
                if ("where" in indexDef && indexDef.where) {
                  idx = (idx as any).where(indexDef.where);
                }
                configs.push(idx);
              }
            }
          }
        }
      }

      // Build foreign keys
      if (entity.options.foreignKeys) {
        for (const fkDef of entity.options.foreignKeys) {
          const columnNames = fkDef.columns.map((col) =>
            this.toColumnName(col as string),
          );

          // Use original camelCase property names for lookup
          const cols = fkDef.columns
            .map((col) => (self as any)[col])
            .filter(Boolean);

          if (cols.length === fkDef.columns.length) {
            const fkName =
              fkDef.name || `${entity.name}_${columnNames.join("_")}_fk`;

            // Resolve foreign column references
            const foreignColumns = fkDef.foreignColumns.map((colRef) => {
              const entityCol = colRef();
              if (!entityCol || !entityCol.entity || !entityCol.name) {
                throw new AlephaError(
                  `Invalid foreign column reference in ${entity.name}`,
                );
              }

              // If we have a table resolver, use it to get the actual table column
              if (tableResolver) {
                const foreignTable = tableResolver(entityCol.entity.name);
                if (!foreignTable) {
                  throw new AlephaError(
                    `Foreign table ${entityCol.entity.name} not found for ${entity.name}`,
                  );
                }
                // Use original camelCase property name for lookup in foreign table
                return foreignTable[entityCol.name];
              }

              // Fallback: return the entity column reference (will be resolved later)
              return entityCol;
            });

            configs.push(
              builders.foreignKey({
                name: fkName,
                columns: cols,
                foreignColumns,
              }),
            );
          }
        }
      }

      // Build constraints
      if (entity.options.constraints) {
        for (const constraintDef of entity.options.constraints) {
          const columnNames = constraintDef.columns.map((col) =>
            this.toColumnName(col as string),
          );

          // Use original camelCase property names for lookup
          const cols = constraintDef.columns
            .map((col) => (self as any)[col])
            .filter(Boolean);

          if (cols.length === constraintDef.columns.length) {
            if (constraintDef.unique) {
              const constraintName =
                constraintDef.name ||
                `${entity.name}_${columnNames.join("_")}_unique`;

              configs.push(builders.unique(constraintName).on(...cols));
            }

            if (constraintDef.check) {
              const constraintName =
                constraintDef.name ||
                `${entity.name}_${columnNames.join("_")}_check`;

              configs.push(builders.check(constraintName, constraintDef.check));
            }
          }
        }
      }

      // Add custom config if provided
      if (entity.options.config && customConfigHandler) {
        configs.push(...customConfigHandler(entity.options.config, self));
      } else if (entity.options.config) {
        // Default behavior: call the config function directly
        const customConfigs = entity.options.config(self as any);
        if (Array.isArray(customConfigs)) {
          configs.push(...(customConfigs as any));
        }
      }

      return configs;
    };
  }
}

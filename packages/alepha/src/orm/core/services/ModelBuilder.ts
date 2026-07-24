import { AlephaError } from "alepha";
import type { SQL } from "drizzle-orm";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type { SequencePrimitive } from "../primitives/$sequence.ts";

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
   * Resolve a column the entity's `indexes` / `foreignKeys` / `constraints`
   * refer to, failing loudly when it does not exist.
   *
   * Every one of those builder paths used to guard with a truthiness check and
   * *skip* the config when the lookup missed: a typo'd column produced no
   * index, no foreign key, no constraint — and no error. Migration generation
   * then emitted a schema quietly missing it, which is a data-integrity
   * hazard that only surfaces as a duplicate row or an orphan much later.
   *
   * TypeScript already rejects the typo at the call site; this covers the
   * paths where the types are bypassed (`as any`, dynamically built entities,
   * JavaScript consumers).
   */
  protected resolveConfigColumn(
    self: any,
    entity: EntityPrimitive,
    column: string,
    kind: string,
  ): any {
    const resolved = self?.[column];

    if (!resolved) {
      throw new AlephaError(this.unknownColumnMessage(entity, column, kind));
    }

    return resolved;
  }

  protected unknownColumnMessage(
    entity: EntityPrimitive,
    column: string,
    kind: string,
  ): string {
    const known = Object.keys(entity.schema.properties ?? {})
      .sort()
      .join(", ");

    return `Entity '${entity.name}' declares a ${kind} on unknown column '${column}'. Known columns: ${known}`;
  }

  /**
   * Check every column named by `indexes` / `foreignKeys` / `constraints`
   * against the entity's schema, at build time.
   *
   * The per-column resolution below runs inside the config closure, and
   * drizzle does not call that closure when the table is constructed — it
   * stores it and invokes it later, during migration generation. Waiting
   * until then to report a typo is too late to be useful, so the same check
   * runs eagerly here against the declared schema.
   */
  protected assertConfigColumnsExist(entity: EntityPrimitive): void {
    const declared = new Set(Object.keys(entity.schema.properties ?? {}));

    const assert = (column: string, kind: string) => {
      if (!declared.has(column)) {
        throw new AlephaError(this.unknownColumnMessage(entity, column, kind));
      }
    };

    for (const indexDef of entity.options.indexes ?? []) {
      if (typeof indexDef === "string") {
        assert(indexDef, "index");
      } else if (indexDef && typeof indexDef === "object") {
        if ("column" in indexDef) {
          assert(indexDef.column as string, "index");
        } else if ("columns" in indexDef) {
          for (const column of indexDef.columns) {
            assert(column as string, "index");
          }
        }
        // `expressions` receives the built table and is the caller's own code.
      }
    }

    for (const fkDef of entity.options.foreignKeys ?? []) {
      for (const column of fkDef.columns) {
        assert(column as string, "foreign key");
      }
    }

    for (const constraintDef of entity.options.constraints ?? []) {
      for (const column of constraintDef.columns) {
        assert(column as string, "constraint");
      }
    }
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

    this.assertConfigColumnsExist(entity);

    return (self: TSelf) => {
      const configs: TConfig[] = [];

      // Build indexes
      if (entity.options.indexes) {
        for (const indexDef of entity.options.indexes) {
          if (typeof indexDef === "string") {
            const columnName = this.toColumnName(indexDef);
            const indexName = `${entity.name}_${columnName}_idx`;

            // Use original camelCase property name for lookup
            configs.push(
              builders
                .index(indexName)
                .on(this.resolveConfigColumn(self, entity, indexDef, "index")),
            );
          } else if (typeof indexDef === "object" && indexDef !== null) {
            if ("column" in indexDef) {
              const columnName = this.toColumnName(indexDef.column as string);
              const indexName =
                indexDef.name || `${entity.name}_${columnName}_idx`;

              // Use original camelCase property name for lookup
              const column = this.resolveConfigColumn(
                self,
                entity,
                indexDef.column as string,
                "index",
              );
              let idx = indexDef.unique
                ? builders.uniqueIndex(indexName).on(column)
                : builders.index(indexName).on(column);
              if ("where" in indexDef && indexDef.where) {
                idx = (idx as any).where(indexDef.where);
              }
              configs.push(idx);
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
              const cols = indexDef.columns.map((col: any) =>
                this.resolveConfigColumn(self, entity, col, "index"),
              );

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

      // Build foreign keys
      if (entity.options.foreignKeys) {
        for (const fkDef of entity.options.foreignKeys) {
          const columnNames = fkDef.columns.map((col) =>
            this.toColumnName(col as string),
          );

          // Use original camelCase property names for lookup
          const cols = fkDef.columns.map((col) =>
            this.resolveConfigColumn(
              self,
              entity,
              col as string,
              "foreign key",
            ),
          );

          const fkName =
            fkDef.name || `${entity.name}_${columnNames.join("_")}_fk`;

          // Resolve foreign column references
          const foreignColumns = fkDef.foreignColumns.map((colRef) => {
            const entityCol = colRef();
            if (!entityCol?.entity || !entityCol.name) {
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

      // Build constraints
      if (entity.options.constraints) {
        for (const constraintDef of entity.options.constraints) {
          const columnNames = constraintDef.columns.map((col) =>
            this.toColumnName(col as string),
          );

          // Use original camelCase property names for lookup
          const cols = constraintDef.columns.map((col) =>
            this.resolveConfigColumn(self, entity, col as string, "constraint"),
          );

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

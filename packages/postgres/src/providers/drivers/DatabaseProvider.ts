import {
  $inject,
  Alepha,
  AlephaError,
  type Static,
  type TObject,
} from "@alepha/core";
import type { SQLWrapper } from "drizzle-orm";
import {
  alias,
  type PgDatabase,
  type PgTableWithColumns,
} from "drizzle-orm/pg-core";
import type {
  EntityDescriptor,
  SchemaToTableConfig,
} from "../../descriptors/$entity.ts";
import type { SequenceDescriptor } from "../../descriptors/$sequence.ts";
import type { ModelBuilder } from "../../services/ModelBuilder.ts";

export type SQLLike = SQLWrapper | string;

export abstract class DatabaseProvider {
  protected readonly alepha = $inject(Alepha);
  protected abstract readonly builder: ModelBuilder;
  public abstract readonly db: PgDatabase<any>;
  public abstract readonly dialect: "postgres" | "sqlite";

  public readonly enums = new Map<string, unknown>();
  public readonly tables = new Map<string, unknown>();
  public readonly sequences = new Map<string, unknown>();

  public table<T extends TObject>(
    entity: EntityDescriptor<T>,
  ): PgTableWithColumns<SchemaToTableConfig<T>> {
    const table = this.tables.get(entity.name);
    if (!table) {
      throw new AlephaError(`Table '${entity.name}' is not registered`);
    }

    const hasAlias = (entity as any).$alias;

    if (hasAlias) {
      return alias(
        table as PgTableWithColumns<SchemaToTableConfig<T>>,
        hasAlias,
      ) as PgTableWithColumns<SchemaToTableConfig<T>>;
    }

    return table as PgTableWithColumns<SchemaToTableConfig<T>>;
  }

  public get schema() {
    return "public";
  }

  public registerEntity(entity: EntityDescriptor) {
    this.builder.buildTable(entity, this);
  }

  public registerSequence(sequence: SequenceDescriptor) {
    this.builder.buildSequence(sequence, this);
  }

  public abstract execute(
    statement: SQLLike,
  ): Promise<Record<string, unknown>[]>;

  public async run<T extends TObject>(
    statement: SQLLike,
    schema: T,
  ): Promise<Array<Static<T>>> {
    const result = await this.execute(statement);
    return result.map((row) => this.alepha.codec.decode(schema, row));
  }
}

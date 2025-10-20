import type { Static, TObject } from "@alepha/core";
import { $inject, Alepha } from "@alepha/core";
import type { SQLWrapper } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

export type SQLLike = SQLWrapper | string;

export abstract class PostgresProvider {
  protected readonly alepha = $inject(Alepha);

  public abstract get db(): PgDatabase<any>;

  public readonly dialect: "postgres" | "sqlite" = "postgres";

  public get schema() {
    return "public";
  }

  public async execute<T extends TObject | undefined>(
    query: SQLLike,
    schema?: T,
  ): Promise<Array<T extends TObject ? Static<T> : any>> {
    if (schema) {
      return this.mapResult(await this.db.execute(query), schema);
    }

    return (await this.db.execute(query)) as Array<
      T extends TObject ? Static<T> : any
    >;
  }

  protected mapResult<T extends TObject = any>(
    result: Array<any>,
    schema?: T,
  ): Array<T extends TObject ? Static<T> : any> {
    if (!schema) {
      return result;
    }

    return result.map((row) => this.alepha.parse(schema, row)) as Array<any>;
  }
}

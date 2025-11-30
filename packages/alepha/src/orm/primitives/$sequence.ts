import { createPrimitive, KIND, Primitive } from "alepha";
import { sql } from "drizzle-orm";
import type { PgSequenceOptions } from "drizzle-orm/pg-core";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

/**
 * Creates a PostgreSQL sequence primitive for generating unique numeric values.
 */
export const $sequence = (
  options: SequencePrimitiveOptions = {},
): SequencePrimitive => {
  return createPrimitive(SequencePrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface SequencePrimitiveOptions extends PgSequenceOptions {
  /**
   * The name of the sequence. If not provided, the property key will be used.
   */
  name?: string;

  provider?: DatabaseProvider;
}

// ---------------------------------------------------------------------------------------------------------------------

export class SequencePrimitive extends Primitive<SequencePrimitiveOptions> {
  public readonly provider = this.$provider();

  public onInit() {
    this.provider.registerSequence(this);
  }

  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  public async next(): Promise<number> {
    return this.provider
      .execute(
        sql`SELECT nextval('${sql.raw(this.provider.schema)}."${sql.raw(this.name)}"')`,
      )
      .then((rows) => Number(rows[0]?.nextval));
  }

  public async current(): Promise<number> {
    return this.provider
      .execute(
        sql`SELECT last_value FROM ${sql.raw(this.provider.schema)}."${sql.raw(this.name)}"`,
      )
      .then((rows) => Number(rows[0]?.last_value));
  }

  protected $provider() {
    return this.options.provider ?? this.alepha.inject(DatabaseProvider);
  }
}

$sequence[KIND] = SequencePrimitive;

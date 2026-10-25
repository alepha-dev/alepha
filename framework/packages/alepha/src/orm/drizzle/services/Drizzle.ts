import type { ZObject } from "alepha";
import type {
  DatabaseProvider,
  DbTable,
  DbTransaction,
  Repository,
} from "alepha/orm";
import type {
  PgAsyncDatabase,
  PgAsyncTransaction,
  PgTableWithColumns,
} from "drizzle-orm/pg-core";

import type { SchemaToTableConfig } from "../types/SchemaToTableConfig.ts";

/**
 * The drizzle objects behind `alepha/orm`'s own types.
 *
 * ⚠️ Outside semver. `alepha/orm` pins drizzle exactly and may move to a new
 * drizzle release in any minor version; whatever is reached through here
 * follows drizzle's API, not Alepha's.
 *
 * @example
 * ```ts
 * import { Drizzle, eq } from "alepha/orm/drizzle";
 *
 * const users = Drizzle.table(this.users);
 * const rows = await Drizzle.db(this.users)
 *   .select({ id: users.id })
 *   .from(users)
 *   .where(eq(users.email, email));
 * ```
 */
export class Drizzle {
  /**
   * The drizzle table of a repository (plain or relational), typed from its
   * entity's schema.
   */
  public static table<T extends ZObject>(source: {
    readonly table: DbTable<T>;
  }): PgTableWithColumns<SchemaToTableConfig<T>> {
    return source.table as unknown as PgTableWithColumns<
      SchemaToTableConfig<T>
    >;
  }

  /**
   * The drizzle database a repository or a provider runs on.
   *
   * It is the connection (or pool), not the ambient transaction: inside a
   * `$transactional` block, pass {@link Drizzle.tx} the transaction instead.
   * On SQLite drivers the object is a drizzle SQLite database typed as the
   * Postgres one, which is how `alepha/orm` drives both dialects.
   */
  public static db(
    source: DatabaseProvider | Repository<any>,
  ): PgAsyncDatabase<any> {
    const provider = "provider" in source ? source.provider : source;
    return provider.db as PgAsyncDatabase<any>;
  }

  /**
   * The drizzle transaction behind a {@link DbTransaction}.
   */
  public static tx(tx: DbTransaction): PgAsyncTransaction<any> {
    return tx as unknown as PgAsyncTransaction<any>;
  }
}

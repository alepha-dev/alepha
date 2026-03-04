import { KIND, type TObject } from "alepha";
import type { SQL } from "drizzle-orm";

/**
 * Creates a database view primitive from a TypeBox schema and SQL query.
 *
 * Views are read-only: Repository blocks all write operations.
 *
 * @example
 * ```ts
 * import { t } from "alepha";
 * import { $view } from "alepha/orm";
 * import { sql } from "drizzle-orm";
 *
 * const userSummary = $view({
 *   name: "user_summary",
 *   schema: t.object({
 *     id: t.uuid(),
 *     fullName: t.text(),
 *     orderCount: t.integer(),
 *   }),
 *   query: sql`SELECT u.id, u.first_name || ' ' || u.last_name AS full_name, COUNT(o.id) AS order_count FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id`,
 * });
 *
 * // Materialized view (PostgreSQL only)
 * const monthlyStats = $view({
 *   name: "monthly_stats",
 *   schema: t.object({ ... }),
 *   query: sql`...`,
 *   materialized: true,
 * });
 * ```
 */
export const $view = <TSchema extends TObject>(
  options: ViewPrimitiveOptions<TSchema>,
): ViewPrimitive<TSchema> => {
  return new ViewPrimitive<TSchema>(options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ViewPrimitiveOptions<T extends TObject> {
  /**
   * The database view name.
   */
  name: string;

  /**
   * TypeBox schema defining the view's columns.
   */
  schema: T;

  /**
   * SQL query that defines the view.
   */
  query: SQL;

  /**
   * Whether this is a materialized view (PostgreSQL only).
   * Materialized views store results on disk and can be refreshed.
   */
  materialized?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ViewPrimitive<T extends TObject = TObject> {
  public readonly options: ViewPrimitiveOptions<T>;
  public readonly isView = true;

  constructor(options: ViewPrimitiveOptions<T>) {
    this.options = options;
  }

  get name(): string {
    return this.options.name;
  }

  get schema(): T {
    return this.options.schema;
  }

  get materialized(): boolean {
    return this.options.materialized ?? false;
  }
}

$view[KIND] = ViewPrimitive;

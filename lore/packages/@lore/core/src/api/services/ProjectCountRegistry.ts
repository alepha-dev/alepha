import { $inject, AlephaError, z } from "alepha";
import { DatabaseProvider, sql } from "alepha/orm";

/**
 * Per-project counts that core shows and a feature module owns (#E75,
 * #Q2623): the Home cards' draft epics, open blights and pending feedback,
 * the overview's areas and open quests.
 *
 * Core reads no module's table. Each module registers a provider for the
 * counts it owns, and core asks for them by key, for a whole list of projects
 * at once, never one per project. A key no module registered counts nothing,
 * which is the zero a badge shows.
 *
 * A provider either counts itself (`count`), or hands core a grouped SELECT
 * (`select`) that core runs together with the others asked in the same call:
 * every `select` provider of one `countMany` is ONE statement, a `UNION ALL`
 * over a `VALUES` table of the ids. On D1 a statement is a round trip, and
 * Home's three cards were one statement before the split
 * (`test/home-query-budget.spec.ts` pins it).
 */
export class ProjectCountRegistry {
  protected readonly database = $inject(DatabaseProvider);
  protected readonly providers = new Map<string, ProjectCountProvider>();

  /**
   * Register a count. A key is owned by one module.
   */
  public register(provider: ProjectCountProvider): void {
    if (this.providers.has(provider.key)) {
      throw new AlephaError(
        `Project count '${provider.key}' is registered twice: one module owns each count`,
      );
    }
    this.providers.set(provider.key, provider);
  }

  /**
   * One count for every project in the list, by project id. Empty when no
   * module registered the key, or the list is empty.
   */
  public async count(
    key: string,
    projectIds: readonly number[],
  ): Promise<Map<number, number>> {
    return (await this.countMany([key], projectIds)).get(key) ?? new Map();
  }

  /**
   * Several counts for every project in the list, by key then project id.
   * The `select` providers among them share one statement.
   */
  public async countMany(
    keys: readonly string[],
    projectIds: readonly number[],
  ): Promise<Map<string, Map<number, number>>> {
    const out = new Map<string, Map<number, number>>(
      keys.map((key) => [key, new Map()]),
    );
    if (projectIds.length === 0) return out;

    const providers = keys.flatMap((key) => {
      const provider = this.providers.get(key);
      return provider ? [provider] : [];
    });
    const selects = providers.filter((it) => it.select);
    const counted = providers.filter((it) => !it.select && it.count);

    await Promise.all([
      ...counted.map(async (provider) => {
        out.set(provider.key, await provider.count!(projectIds));
      }),
      (async () => {
        if (selects.length === 0) return;
        // The id list is bound once, as a `VALUES` table every branch reads,
        // rather than as an `IN (...)` per branch: D1 caps a statement at 100
        // bound parameters. `CAST` because a bare `VALUES` parameter has no
        // type of its own to compare against an integer column.
        const ids = sql.join(
          projectIds.map((id) => sql`(CAST(${id} AS INTEGER))`),
          sql`, `,
        );
        const rows = await this.database.run(
          sql`
            WITH ids(id) AS (VALUES ${ids})
            ${sql.join(
              selects.map(
                (provider) =>
                  sql`SELECT ${provider.key} AS kind, project_id, n FROM (${provider.select!()})`,
              ),
              sql` UNION ALL `,
            )}
          `,
          z.object({
            kind: z.string(),
            project_id: z.coerce.number(),
            n: z.coerce.number(),
          }),
        );
        for (const row of rows) {
          out.get(row.kind)?.set(row.project_id, row.n);
        }
      })(),
    ]);
    return out;
  }
}

/**
 * One per-project count, as a module registers it.
 */
export interface ProjectCountProvider {
  key: string;
  /**
   * A grouped SELECT of `project_id` and `n`, reading the project ids from
   * the `ids` table core binds (`WHERE ... IN (SELECT id FROM ids)`).
   */
  select?: () => ReturnType<typeof sql>;
  /**
   * Or the count itself, for each project id, absent where there is none.
   */
  count?: (projectIds: readonly number[]) => Promise<Map<number, number>>;
}

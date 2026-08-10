import { $inject } from "alepha";
import { DatabaseProvider } from "alepha/orm";
import { sigilViewsHourly } from "../entities/sigilViewsHourly.ts";
import { sigilVitalsHourly } from "../entities/sigilVitalsHourly.ts";

/**
 * Keeps `sigil_views_hourly` and `sigil_vitals_hourly` in the migration
 * snapshot without giving any service a queryable repository on them.
 *
 * ## Why this class has to exist
 *
 * Alepha's migration generator does not diff against `$entity()`
 * declarations directly — an entity only joins `DatabaseProvider`'s
 * registered schema when some class actually constructed in the DI graph
 * holds a live `$repository()` for it; `Repository`'s constructor is the only
 * caller of `DatabaseProvider.registerEntity`. Task 14 removed the last two
 * repository fields on these two tables — `LoreAnalyticsStore` and
 * `SigilJobs` each used to hold one, and neither does anymore, because
 * nothing in the app reads or writes either table any more (views and vitals
 * moved onto `LoreAnalytics`'s `$analytics()` datasets). Left alone, that
 * silently turns into `yarn check:migrations` proposing
 * `DROP TABLE sigil_views_hourly` / `DROP TABLE sigil_vitals_hourly` on the
 * next run — exactly the destructive migration this task was told never to
 * generate. Both tables carry production rows from every deployment before
 * this task; only the code that read and wrote them was in scope to go.
 *
 * ## Why a direct `registerEntity` call, not `$repository()`
 *
 * `$repository()` would fix the drift the same way, but it would also hand
 * back a full queryable `Repository` — `.findMany`, `.create`, the works —
 * which is exactly the temptation this task exists to remove. Calling
 * `DatabaseProvider.registerEntity` directly is what `Repository`'s own
 * constructor does for schema-registration purposes; skipping the rest of
 * `Repository` is what makes a future `findMany` on either table show up as a
 * new, deliberate import here rather than something already lying around to
 * reach for.
 *
 * Dropping these tables for real is a separate decision that needs its own
 * migration review — see the task brief this class was added under. When
 * that decision is made, this class is what to delete first.
 */
export class FrozenSigilAnalyticsTables {
  protected readonly database = $inject(DatabaseProvider);

  constructor() {
    this.database.registerEntity(sigilViewsHourly);
    this.database.registerEntity(sigilVitalsHourly);
  }
}

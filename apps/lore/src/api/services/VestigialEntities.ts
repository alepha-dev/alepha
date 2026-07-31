import { $repository } from "alepha/orm";
import { sigilBlightRate } from "../entities/sigilBlightRate.ts";
import { sigilUniqueVisitors } from "../entities/sigilUniqueVisitors.ts";
import { sigilViews } from "../entities/sigilViews.ts";
import { sigilVitals } from "../entities/sigilVitals.ts";

/**
 * Holds the tables nothing reads any more, so nothing drops them.
 *
 * An entity only exists as far as the schema is concerned if some
 * `$repository` references it. When the Insights and Beacon code was deleted,
 * these four lost their last reference — and the very next `db migrations
 * create` produced four `DROP TABLE` statements.
 *
 * On D1 that is not housekeeping, it is data loss: `PRAGMA foreign_keys=OFF` is
 * ignored there, so dropping a table fires every `ON DELETE CASCADE` pointing
 * at it. A migration of exactly this shape erased lore-production in May 2026.
 *
 * So the rows stay, unread, until someone decides deliberately to remove them —
 * with a hand-written migration, not one drizzle-kit inferred from an import
 * that happened to disappear.
 *
 * Nothing here has behaviour. Deleting this file re-arms the same migration.
 */
export class VestigialEntities {
  protected readonly views = $repository(sigilViews);
  protected readonly uniqueVisitors = $repository(sigilUniqueVisitors);
  protected readonly vitals = $repository(sigilVitals);
  protected readonly blightRate = $repository(sigilBlightRate);
}

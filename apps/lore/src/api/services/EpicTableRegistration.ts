import { $inject } from "alepha";
import { DatabaseProvider } from "alepha/orm";
import { epics } from "../entities/epics.ts";

/**
 * Registers `epics` with the `DatabaseProvider` so its table joins the
 * migration snapshot before any service actually queries it.
 *
 * ## Why this class has to exist (temporarily)
 *
 * Alepha's migration generator does not diff against `$entity()`
 * declarations directly — an entity only joins `DatabaseProvider`'s
 * registered schema when some class actually constructed in the DI graph
 * holds a live `$repository()` for it; `Repository`'s constructor is the
 * only other caller of `DatabaseProvider.registerEntity`. This task (Lore
 * Epics #1) creates the `epics` table plus the `quests.epicId` /
 * `folios.epicId` foreign keys that point at it, but the first real
 * consumer — `EpicController` — doesn't land until a later task in the same
 * plan. Without this class, `yarn alepha db migrations create` fails to
 * resolve those FKs ("Referenced table epics not found for
 * folios.epicId"), and `yarn check:migrations` would propose dropping the
 * freshly-created table right back out.
 *
 * Same mechanism `FrozenSigilAnalyticsTables` uses, for the opposite
 * reason: that class keeps a table that lost its last repository, this one
 * keeps a table that doesn't have its first one yet.
 *
 * **Delete this class once `EpicController` (or any other permanent
 * `$repository(epics)` consumer) exists** — its own repository field takes
 * over this job, and this one becomes a redundant second registration.
 */
export class EpicTableRegistration {
  protected readonly database = $inject(DatabaseProvider);

  constructor() {
    this.database.registerEntity(epics);
  }
}

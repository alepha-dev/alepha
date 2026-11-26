import { $repository } from "alepha/orm";

import { questComments } from "../entities/questComments.ts";

/**
 * Keeps Plan's retired comment tables declared until they are dropped
 * (#E185).
 *
 * A quest's discussion is rows of core's `comments` now, and nothing reads
 * `quest_comments`. The table is still on disk, by the owner's decision: its
 * rows were copied, and it is dropped by a later migration once the counts
 * are compared on production. Registering its entity here, and nowhere else,
 * keeps it in the migration snapshot, so no migration drops it by accident
 * and the safety spec still guards it.
 *
 * ⚠️ Never read through these repositories. To drop a table: delete its
 * entity file and its line here, generate the migration, and give the
 * `DROP TABLE` its marker and its `SANCTIONED_DROPS` entry.
 */
export class RetiredCommentTables {
  protected readonly questComments = $repository(questComments);
}

import { $repository } from "alepha/orm";

import { requirementsComments } from "../entities/requirementsComments.ts";

/**
 * Keeps `requirements_comments` declared until it is dropped (#E185).
 *
 * A persona's and a use case's discussion are rows of core's `comments`
 * now, and nothing reads the old table. It is still on disk, by the owner's
 * decision: its rows were copied, and it is dropped by a later migration,
 * with Plan's two retired comment tables, once the counts are compared on
 * production. Registering its entity here, and nowhere else, keeps it in
 * the migration snapshot, so no migration drops it by accident and the
 * safety spec still guards it.
 *
 * ⚠️ Never read through this repository. To drop the table: delete its
 * entity file and this class, generate the migration, and give the `DROP
 * TABLE` its marker and its `SANCTIONED_DROPS` entry.
 */
export class RetiredCommentTables {
  protected readonly requirementsComments = $repository(requirementsComments);
}

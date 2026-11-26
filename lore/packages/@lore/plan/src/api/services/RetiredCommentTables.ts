import { $repository } from "alepha/orm";

import { feedbackComments } from "../entities/feedbackComments.ts";
import { questComments } from "../entities/questComments.ts";

/**
 * Keeps Plan's retired comment tables declared until they are dropped
 * (#E185).
 *
 * A quest's discussion and a feedback item's thread are rows of core's
 * `comments` now, and nothing reads `quest_comments` or `feedback_comments`.
 * Both tables are still on disk, by the owner's decision: their rows were
 * copied, and they are dropped by a later migration once the counts are
 * compared on production. Registering their entities here, and nowhere
 * else, keeps them in the migration snapshot, so no migration drops one by
 * accident and the safety spec still guards them.
 *
 * ⚠️ Never read through these repositories. To drop a table: delete its
 * entity file and its line here, generate the migration, and give the
 * `DROP TABLE` its marker and its `SANCTIONED_DROPS` entry.
 */
export class RetiredCommentTables {
  protected readonly questComments = $repository(questComments);
  protected readonly feedbackComments = $repository(feedbackComments);
}

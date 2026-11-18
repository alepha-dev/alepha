import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * The quests one commit's history references, kept once per
 * `(project, commit)` (#E154, folio #F1516), and once more per app that
 * declares its paths (#Q3868).
 *
 * A commit's set is a function of the commit alone: every `#Q<n>` in the
 * messages of its history, plus every quest whose recorded sha is in that
 * history. So it is stored once and shared by every artifact, variant,
 * redeploy and rollback of that commit, and a deployment reaches it through
 * the `commitSha` it snapshots.
 *
 * ## One row per app that declares its paths
 *
 * In a repository holding several apps, ancestry alone says a quest for one
 * app is live on every other. So an app may declare the paths it is built
 * from, and a push of it keeps a second row for the commit, under
 * {@link app}: the quests of the commits that touched those paths. The row
 * with `app: ""` is the whole history, always written, and what "behind" is
 * read against.
 *
 * ## Each row holds the FULL set, never a delta
 *
 * The push is incremental (`set(HEAD) = set(base) + refs(base..HEAD)`), but
 * Lore adds the base's set before it writes, so a read is one lookup and
 * never a chain.
 *
 * ## The table names no writer
 *
 * The artifact push fills it today. Lore's own copy of a project's
 * repository is meant to fill it later. Both obey one rule: a complete set
 * replaces an incomplete one, never the reverse (`CommitQuestSetService`).
 *
 * `projectId` cascades: wiping a project wipes its sets. Nothing references
 * this table, so it is a leaf and never a cascade parent.
 */
export const commitQuestSets = $entity({
  name: "commit_quest_sets",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The full lowercase sha the set belongs to.
     */
    commitSha: z.string().min(7).max(40),
    /**
     * The app whose paths the set was walked with (#Q3868), or `""` for the
     * whole history. A plain string like `artifacts.app`: there is no apps
     * table.
     */
    app: db.default(z.string().max(100), ""),
    /**
     * The paths that app declared, as git pathspecs joined by line breaks,
     * sorted. Empty on the whole-history row.
     *
     * ⚠️ A set is a base only for a walk over the SAME paths: after the
     * list changes, the next push walks the whole history again and
     * replaces the row, rather than adding to quests the old paths found.
     */
    paths: z.string().max(2000).optional(),
    /**
     * The quest numbers, as a base64 bitmap where bit `n` means `#Q<n>`
     * (`QuestBitmap`): about 630 bytes for a project of 5,000 quests, where
     * a JSON array of the same set is 8 KB. 65,536 characters holds numbers
     * up to about 390,000.
     */
    quests: z.string().max(65_536),
    /**
     * False when the set rests on an incomplete history: a shallow clone with
     * no known base, no repository, or a failed git. Each number in it is
     * still a true ancestor's, so a chip may show; "not live" and "behind"
     * are never claimed from it.
     */
    complete: z.boolean(),
  }),
  indexes: [{ columns: ["projectId", "commitSha", "app"], unique: true }],
});

export type CommitQuestSet = Infer<typeof commitQuestSets.schema>;

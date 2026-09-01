import { type Infer } from "alepha";

import { epicResourceSchema } from "./epicResourceSchema.ts";

/**
 * An epic as the roadmap publishes it. Four fields, and the list is closed.
 *
 * Picked off {@link epicResourceSchema} rather than restated, so `status` and
 * the four progress buckets keep one declaration. Picking also means the
 * default is exclusion: a field added to the epic entity does NOT appear here,
 * which is the property that matters when the audience may be the internet.
 *
 * `id`, `projectId`, `releaseId`, `createdAt`, `activatedAt` and
 * `description` are all deliberately absent. `number` is what a reader refers
 * to an epic by, and it is per-project rather than global, so it identifies
 * nothing outside the project whose roadmap this is.
 *
 * ⚠️ `progress` counts EVERY quest of the epic, planned-gated ones included -
 * the same convention `epicResourceSchema` documents. An epic reporting 0/13
 * is telling the truth; one reporting 0/0 because its own quests are gated out
 * of the project's backlog is not.
 */
export const roadmapEpicSchema = epicResourceSchema.pick({
  number: true,
  title: true,
  status: true,
  progress: true,
  /**
   * The epic that comes first, as its per-project `number` - never the id
   * `epics.dependsOn` actually stores.
   *
   * This is the field the whole column exists for: the roadmap DRAWS the
   * order rather than asking the reader to parse "depends on epic #14
   * landing first" out of a paragraph. It is also why `dependsOnNumber` is
   * resolved in `EpicController.buildEpicResource` rather than here - a
   * public payload must not learn to translate ids.
   *
   * It discloses no more than the epic titles beside it already do: a
   * per-project ordinal identifies nothing outside the project whose roadmap
   * this is.
   */
  dependsOnNumber: true,
});

export type RoadmapEpic = Infer<typeof roadmapEpicSchema>;

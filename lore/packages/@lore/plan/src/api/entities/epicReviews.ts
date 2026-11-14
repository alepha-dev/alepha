import { projects, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { epics } from "./epics.ts";

/**
 * One review of an epic's plan (#E121, folio #F1460): what one run of
 * "Review epic" found, filed in one call with its items
 * (`epic_review_items`). An empty review, with no item at all, is valid:
 * a reviewer made to file something files filler.
 *
 * Written only while the epic is `draft` or `ready`
 * (`EpicWorkflowService.assertReviewWritable`): from `in_progress` on the
 * review set is locked with the quest set, read-only.
 *
 * `EpicReviewService` owns every rule. Deleting an epic deletes its reviews
 * explicitly, before the epic (`EpicController.deleteEpic`); the cascade on
 * `epicId` is the backstop for a project deletion, which reaches epics
 * through `projects`' own cascade.
 */
export const epicReviews = $entity({
  name: "epic_reviews",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    /**
     * Kept beside `epicId` for the audit scope and the project merge, which
     * rewrites it with the epic's own (`WorkProjectMerge`).
     */
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    epicId: db.ref(z.integer(), () => epics.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Who filed it, or `null` once they deleted their account. Set-null and
     * not cascade, for the reason `questComments.authorId` gives: a review
     * is half of a conversation the owner is still reading.
     */
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * What the review concluded, in a line or two.
     */
    summary: db.default(z.string().max(2000), ""),
  }),
  indexes: [{ columns: ["epicId", "createdAt"] }],
});

export type EpicReview = Infer<typeof epicReviews.schema>;

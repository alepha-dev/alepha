import { users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { epicReviewItemKindSchema } from "../schemas/epicReviewItemKindSchema.ts";
import { epicReviewItemStateSchema } from "../schemas/epicReviewItemStateSchema.ts";
import { epicReviewSuggestionSchema } from "../schemas/epicReviewSuggestionSchema.ts";
import { epicReviewTargetSchema } from "../schemas/epicReviewTargetSchema.ts";
import { epicReviews } from "./epicReviews.ts";
import { epics } from "./epics.ts";

/**
 * One question, decision or change of an epic review (#E121).
 *
 * **Numbered per epic**, 1-based, across every review of that epic: "answer
 * 3: take B" means the same item in chat, in the UI and in the next review.
 * `EpicReviewService` allocates the number from a `$sequence` scoped on the
 * epic id, and `(epicId, number)` is unique.
 *
 * Every answered question and every decision is the epic's decision log,
 * which `epic_get` inlines and both agent prompts read first.
 */
export const epicReviewItems = $entity({
  name: "epic_review_items",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    reviewId: db.ref(z.integer(), () => epicReviews.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Denormalised from the review, for the per-epic number and the log,
     * both of which read by epic and never by review.
     */
    epicId: db.ref(z.integer(), () => epics.cols.id, {
      onDelete: "cascade",
    }),
    number: z.integer().min(1),
    kind: epicReviewItemKindSchema.meta({ mode: "text" }),
    /**
     * The question in one sentence, the decision taken, or the change made.
     */
    title: z.string().min(1).max(1000),
    /**
     * Why it is asked or decided: spec against code, the files named.
     */
    context: db.default(z.string().meta({ size: "rich" }), ""),
    suggestions: db.default(z.array(epicReviewSuggestionSchema), []),
    /**
     * Index into `suggestions` of the one the reviewer would take.
     */
    recommended: z.integer().min(0).optional(),
    /**
     * A question's state; absent on a decision and a change.
     */
    state: epicReviewItemStateSchema.meta({ mode: "text" }).optional(),
    /**
     * The answer to a question, or why a decision was overturned.
     */
    answer: z.string().meta({ size: "rich" }).optional(),
    /**
     * The suggestion the answer picked, when it picked one.
     */
    answerSuggestion: z.integer().min(0).optional(),
    answeredBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    answeredAt: z.datetime().optional(),
    /**
     * On a decision filed by an overturn: the number of the decision it
     * replaces.
     */
    replaces: z.integer().min(1).optional(),
    /**
     * On an overturned decision: the number of the decision that replaced
     * it. An overturned decision leaves the log; its replacement stands.
     */
    replacedBy: z.integer().min(1).optional(),
    /**
     * Who wrote the item when it is not the review's author: the owner who
     * overturned a decision.
     */
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * On a change: the quest or epic it touched.
     */
    target: epicReviewTargetSchema.optional(),
  }),
  indexes: [
    { columns: ["epicId", "number"], unique: true },
    { columns: ["reviewId"] },
  ],
});

export type EpicReviewItem = Infer<typeof epicReviewItems.schema>;

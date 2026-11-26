import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { commentSourceSchema } from "../schemas/commentSourceSchema.ts";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * One comment, on anything a package registered as a subject with
 * `CommentService` (#E185): a quest, a feedback item, a persona, a use case,
 * an error.
 *
 * One table for every thread, so the shape is the union of the three it
 * replaces (`quest_comments`, `feedback_comments`, `requirements_comments`)
 * and each of them moves by a copy.
 *
 * - **Core owns the rows, never the rules.** Who may read or write a thread,
 *   who a mention reaches and what a comment looks like on the wire stay with
 *   the package that owns the subject: there is no comment route in core.
 * - **A subject's delete removes its comments by hand**
 *   (`CommentService.deleteForSubjects`), in the code path of the delete:
 *   nothing cascades from a subject. A project's deletion needs nothing,
 *   `projectId` cascades.
 * - **Triage events are not comments.** A subject's own vocabulary (an
 *   error's resolve, a quest's history) stays in its package, and its page
 *   merges the two reads.
 */
export const comments = $entity({
  name: "comments",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * The only foreign key a polymorphic row can carry: what deletes every
     * thread with its project, and what the activity feed and the project
     * merge scope by.
     */
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The kind of subject, as its package registered it: `quest`,
     * `feedback`, `persona`, `usecase`, `error`.
     */
    subjectType: z.string().min(1).max(32),
    /**
     * The subject row's GLOBAL id (`quests.id`, `project_errors.id`), never
     * a per-project number: a global id survives a project merge.
     *
     * ⚠️ Not a foreign key, and it cannot be one: core references no table
     * of Plan or Ship, and the column names one of several.
     */
    subjectId: z.integer(),
    /**
     * The author, or `null` once they delete their account. Set null, never
     * cascade: erasing one side of a conversation other people still read is
     * not what deleting an account means. The thread shows a tombstone.
     *
     * `.optional()` sits INSIDE `db.ref` on purpose: outside it no foreign
     * key is generated at all, silently.
     */
    authorId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    body: z.string().meta({ size: "rich" }),
    /**
     * Set on every edit after the first save, so a thread can say "edited"
     * honestly. `updatedAt` cannot: the ORM stamps it on any write.
     */
    editedAt: z.datetime().optional(),
    /**
     * File ids of the comment's own attachments, uploaded through the
     * subject's package.
     *
     * ⚠️ Optional with NO `db.default(...)`: a column DEFAULT is a table
     * rebuild on D1. Absent and `[]` both read as no file.
     */
    attachments: z.array(z.uuid()).optional(),
    /**
     * Set only when a machine wrote the comment. See `commentSourceSchema`.
     */
    source: commentSourceSchema.optional(),
  }),
  indexes: [
    // One thread, oldest first.
    { columns: ["subjectType", "subjectId", "createdAt"] },
    // A project's comments in a time window: the activity feed and reports,
    // with no join to the subject's table.
    { columns: ["projectId", "createdAt"] },
  ],
});

export type Comment = Infer<typeof comments.schema>;

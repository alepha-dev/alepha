import { projects, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { commentSubjectKindSchema } from "../schemas/commentSubjectKindSchema.ts";

/**
 * ⚠️ RETIRED (#E185): the table a persona's and a use case's discussion
 * lived in until the comments moved to core's `comments` (subjects
 * `persona` and `usecase`). Nothing reads or writes it any more.
 *
 * Still declared, and only that, because the table is still on disk: its
 * rows were copied by `20261126215005_requirements_comments_to_comments`, and
 * one later
 * migration drops it with Plan's `quest_comments` and `feedback_comments`
 * once the counts are compared on production (review of #E185, item 26).
 * Registered by `RetiredCommentTables` so the snapshot and the migration
 * safety spec still hold it.
 *
 * Do not import it: a comment is a row of `comments`, written through
 * `CommentService`.
 */
export const requirementsComments = $entity({
  name: "requirements_comments",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    subjectKind: commentSubjectKindSchema.meta({ mode: "text" }),
    subjectId: z.integer(),
    /**
     * The author, or `null` once they delete their account: set-null, as
     * on `quest_comments`, so a thread keeps its shape.
     */
    authorId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    body: z.string().meta({ size: "rich" }),
    /**
     * Set when an agent wrote it over MCP, with the name it gave as a
     * client: over MCP the author is the key's owner, so this is the only
     * thing that says a machine wrote the comment. Absent means a person.
     */
    agentClient: z.string().max(60).optional(),
    byAgent: z.boolean().optional(),
  }),
  indexes: [{ columns: ["subjectKind", "subjectId", "createdAt"] }],
});

export type RequirementsComment = Infer<typeof requirementsComments.schema>;

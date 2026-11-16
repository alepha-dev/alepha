import { projects, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { commentSubjectKindSchema } from "../schemas/commentSubjectKindSchema.ts";

/**
 * The discussion of a persona or a use case (#E153). One table for both,
 * keyed by `(subjectKind, subjectId)`: `quest_comments` is keyed on a quest,
 * and there is no generic comment table to reuse.
 *
 * The subject is not a foreign key (it names one of two tables); a subject's
 * delete removes its comments by hand.
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

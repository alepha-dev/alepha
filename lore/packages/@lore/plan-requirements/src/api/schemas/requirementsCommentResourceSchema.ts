import { comments } from "@lore/core/schemas";
import { type Infer, z } from "alepha";

import { commentSubjectKindSchema } from "./commentSubjectKindSchema.ts";

/**
 * One comment on a persona or a use case (#E153), as this package has
 * answered it since the comments were a table of its own.
 *
 * The row is core's `comments` now (#E185): `subjectKind` is its
 * `subjectType`, and `agentClient` / `byAgent` are read from its `source`,
 * so no reader changed.
 */
export const requirementsCommentResourceSchema = comments.schema
  .pick({
    id: true,
    createdAt: true,
    updatedAt: true,
    projectId: true,
    subjectId: true,
    authorId: true,
    body: true,
  })
  .extend({
    subjectKind: commentSubjectKindSchema,
    /**
     * Set when an agent wrote it over MCP, with the name it gave as a
     * client. Absent means a person.
     */
    agentClient: z.string().max(60).optional(),
    byAgent: z.boolean().optional(),
  });

export type RequirementsCommentResource = Infer<
  typeof requirementsCommentResourceSchema
>;

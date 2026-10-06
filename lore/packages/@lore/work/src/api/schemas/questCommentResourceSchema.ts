import type { Infer } from "alepha";

import { questComments } from "../entities/questComments.ts";

/**
 * A quest comment as the API hands it out.
 *
 * The entity shape verbatim: there is no computed metadata to add, and the
 * author is deliberately left as a bare id. The feed resolves ids to names
 * and avatars through `getProjectUsers` — one fetch per page rather than a
 * joined user object per comment, which is the same call it already makes to
 * resolve the actors of the history events it interleaves these with.
 */
export const questCommentResourceSchema = questComments.schema;

export type QuestCommentResource = Infer<typeof questCommentResourceSchema>;

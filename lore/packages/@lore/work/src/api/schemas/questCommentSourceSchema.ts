import { type Infer, z } from "alepha";

/**
 * Provenance of a quest comment that a machine wrote.
 *
 * Absent means a human typed it in the UI. That is the whole semantic: over
 * MCP the session user IS the account that owns the API key, so without this
 * column every comment an agent leaves comes back signed with the owner's
 * name, and the next agent reads its own predecessor's notes as the owner's
 * instructions.
 *
 * Deliberately NOT inferred from the credential. A human can drive the REST
 * API with an API key too; the claim being recorded is "a machine wrote
 * this", not "which token was used".
 *
 * Opaque JSON, modelled on `questSourceSchema`: additive and D1-safe, so a
 * new field here never needs a migration.
 */
export const questCommentSourceSchema = z.object({
  /**
   * How the comment was written. `mcp` is the only value: it is stamped by
   * `QuestTools.quest_comment_add`, which by construction is only ever
   * reached over MCP.
   */
  kind: z.enum(["mcp"]),
  /**
   * Which agent wrote the comment, when it named itself.
   *
   * Taken from `quest_comment_add`'s `as` param rather than from the MCP
   * handshake. `clientInfo` would be no more trustworthy (both are
   * self-reported), and reading it needs framework plumbing that does not
   * exist: `McpServerProvider.handleInitialize` logs `clientInfo` and drops
   * it, the Streamable HTTP transport keeps no per-session state, and the
   * provider is a process-global singleton, which is the exact shape that
   * had to be backed out for protocol-version negotiation.
   *
   * Absent on a comment from an agent that did not name itself. `kind` is
   * the load-bearing half; this only sharpens it.
   */
  client: z.string().optional(),
});

export type QuestCommentSource = Infer<typeof questCommentSourceSchema>;

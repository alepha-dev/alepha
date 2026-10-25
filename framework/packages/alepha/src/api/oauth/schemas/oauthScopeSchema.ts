import { type Infer, z } from "alepha";

/**
 * What a scope means: what a user is told on the consent screen, and what a
 * token granted it may reach.
 *
 * A scope identifier is a protocol token: `mcp`, `profile:write`,
 * `openid`. It is chosen for the wire, and printing it at somebody about to
 * grant it tells them nothing - Lore's consent screen listed a single bullet
 * reading `mcp`, which is what this exists to fix.
 *
 * Declared by the app beside its scopes rather than shipped with the
 * framework, because only the app knows what its own scopes reach. The
 * framework falls back to the raw identifier when an app declares nothing,
 * which is no worse than before and never a blank line.
 *
 * One declaration per scope, so the sentence a person consents to and the
 * permissions the token then carries cannot drift apart.
 */
export const oauthScopeSchema = z.object({
  /**
   * A short phrase, sentence case, naming the capability rather than the
   * token: "Projects, quests and folios", not "mcp".
   */
  label: z.text(),
  /**
   * One line saying what the client will be able to DO. This is the sentence
   * the decision is actually made on, so write it as a capability the reader
   * would recognise - "Read and manage your projects, quests and folios" -
   * and never as a restatement of the label.
   */
  description: z.text().optional(),
  /**
   * The permissions a token granted this scope may use, as `group:name`
   * strings or patterns (`project:*`, `*`). They become the token's
   * `permissionScope`, so a connected app reaches what its scopes declare and
   * not everything its user's roles grant.
   *
   * - A grant's reach is the union of its scopes' lists.
   * - `[]` reaches nothing: an identity scope such as `openid`.
   * - **Absent leaves the whole grant unrestricted**, exactly as before scopes
   *   narrowed anything, so an application's connected apps keep working on
   *   upgrade until it declares them. The server logs a warning at boot for
   *   every declared scope that omits this.
   *
   * Patterns are allowed here, unlike in an API key's stored scope: this is
   * code, and widening it is a deploy somebody made. The list is resolved
   * each time a token is minted, so a changed declaration applies at the
   * next refresh.
   */
  permissions: z.array(z.text()).optional(),
});

export type OAuthScope = Infer<typeof oauthScopeSchema>;

import { type Infer, z } from "alepha";

/**
 * What a user is told a scope means, on the consent screen.
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
 */
export const oauthScopeCopySchema = z.object({
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
});

export type OAuthScopeCopy = Infer<typeof oauthScopeCopySchema>;

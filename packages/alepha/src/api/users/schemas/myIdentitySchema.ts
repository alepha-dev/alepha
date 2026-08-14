import { type Infer, z } from "alepha";

/**
 * One sign-in method as exposed to the account it belongs to.
 *
 * Two columns of the `identities` entity are deliberately absent, and both
 * omissions are security rather than tidiness:
 *
 * - **`password`** is the credential hash. Nothing in a UI needs it, and
 *   shipping it to the browser puts it in every XSS payload and every
 *   HAR file a support ticket ever attaches.
 * - **`providerData`** is whatever the OAuth provider handed back, which
 *   routinely includes access and refresh tokens for that provider. Leaking
 *   it is worse than leaking this account: it is a credential for a
 *   *different* service.
 *
 * `providerUserId` stays — the account holder already knows which GitHub
 * user they are, and it is what lets the UI distinguish two identities from
 * the same provider.
 */
export const myIdentitySchema = z.object({
  id: z.uuid(),

  /**
   * `"credentials"` for a password, otherwise the OAuth provider name.
   */
  provider: z.string(),

  providerUserId: z.string().optional(),
  createdAt: z.datetime(),
  updatedAt: z.datetime(),
});

export type MyIdentity = Infer<typeof myIdentitySchema>;

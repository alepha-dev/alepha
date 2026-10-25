import { type Infer, z } from "alepha";

/**
 * The machine credential a request was authenticated by, when it was not a
 * signed-in session.
 *
 * Absent on a session: a password or social login, a cookie, a realm token a
 * person obtained by signing in. Present when the identity came from a
 * credential a machine holds (an API key, or the access token a connected
 * app obtained through the OAuth authorization server), which may read and call permission-checked
 * actions but may not act as the person: mint or revoke credentials, approve
 * an OAuth grant, or change the account (see `SecureOptions.sessionOnly`).
 *
 * A union from the start, so every kind of machine credential is refused by
 * the same rule: the rule reads "carries a credential", never a type by name.
 */
export const userCredentialSchema = z.union([
  z.object({
    type: z.literal("api-key"),
    id: z.text({
      description: "The API key the request was authenticated by.",
    }),
  }),
  z.object({
    type: z.literal("oauth"),
    clientId: z.text({
      description:
        "The OAuth client the access token was issued to (its `client_id` claim).",
    }),
  }),
]);

export type UserCredential = Infer<typeof userCredentialSchema>;

import { type Infer, z } from "alepha";

/**
 * What a `credentials` identity keeps in `identities.providerData`. The
 * password hash has its own column; this holds what describes the password
 * rather than proves it.
 *
 * - **`mustChangePassword`** marks a temporary password: an admin set it and
 *   asked the user to replace it at their next sign-in. Every password the
 *   user sets themselves clears it. Stored in the JSON column, as TOTP and
 *   passkeys are, so it costs no migration.
 */
export const credentialsIdentityDataSchema = z.object({
  mustChangePassword: z.boolean().optional(),
});

export type CredentialsIdentityData = Infer<
  typeof credentialsIdentityDataSchema
>;

/**
 * Whether a `credentials` identity holds a temporary password.
 *
 * Reads the JSON column defensively: it is untyped in the table, and a row
 * written before the flag existed has no `providerData` at all.
 */
export const credentialsMustChangePassword = (identity?: {
  provider: string;
  providerData?: unknown;
}): boolean => {
  if (identity?.provider !== "credentials") return false;
  const data = identity.providerData as CredentialsIdentityData | undefined;
  return data?.mustChangePassword === true;
};

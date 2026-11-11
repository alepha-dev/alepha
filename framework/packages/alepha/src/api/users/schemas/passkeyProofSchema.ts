import { type Infer, z } from "alepha";
import { authenticationResponseJsonSchema } from "alepha/security";

/**
 * What adding or removing a passkey carries to prove it is the account
 * holder asking, not a borrowed session: the current password when the
 * account has one, else a fresh user-verified assertion from one of its
 * passkeys (options from `POST /users/me/passkeys/proof/options`), else
 * nothing. `GET /users/me/passkeys` says which, in `proof`.
 */
export const passkeyProofSchema = z.object({
  currentPassword: z.text({ maxLength: 1024, trim: false }).optional(),
  assertion: authenticationResponseJsonSchema.optional(),
});

export type PasskeyProof = Infer<typeof passkeyProofSchema>;

import { type Infer, z } from "alepha";

/**
 * Which proof adding or removing a passkey asks of this account:
 * `password` when it has one, `passkey` when it has a usable passkey and no
 * password, `none` when it signs in only through a provider.
 */
export const passkeyProofKindSchema = z.enum(["password", "passkey", "none"]);

export type PasskeyProofKind = Infer<typeof passkeyProofKindSchema>;

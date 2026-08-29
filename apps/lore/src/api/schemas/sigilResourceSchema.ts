import { type Infer, z } from "alepha";

import { sigils } from "../entities/sigils.ts";

/**
 * A sigil as the owner's Settings page sees it.
 *
 * The entity minus the two fields nothing outside the server may read:
 * `tokenHash` (the credential) and `createdBy` (a raw uuid). Derived rather
 * than restated, because the copy had already drifted - `feedbackPosition` is
 * an enum on the column and was a bare `z.string()` here.
 *
 * Lives here rather than beside the controller because the browser reads it
 * too: `currentSigilsAtom` / `currentSigilAtom` validate against this schema on
 * every write, and importing it from `SigilController.ts` would pull the
 * repository and the database provider into the client bundle.
 */
export const sigilResourceSchema = sigils.schema.omit({
  // The credential itself. `tokenPrefix` stays, which is the whole point of
  // keeping a prefix: the UI has to name a credential it can never rebuild.
  tokenHash: true,
  // A raw uuid nothing on this surface resolves to a person.
  createdBy: true,
});

export type SigilResource = Infer<typeof sigilResourceSchema>;

/**
 * A sigil plus the one cleartext copy of its token that will ever exist.
 *
 * Returned by `createSigil` and `rotateSigil` only. Nothing can produce it
 * again — the column stores a hash — so a caller that drops this response has
 * to rotate.
 */
export const mintedSigilSchema = sigilResourceSchema.extend({
  token: z.string(),
});

export type MintedSigil = Infer<typeof mintedSigilSchema>;

import { type Infer, z } from "alepha";

/**
 * A sigil as the owner's Settings page sees it.
 *
 * `tokenHash` is absent and `tokenPrefix` is present, which is the whole point
 * of keeping a prefix: the UI has to be able to name a credential it can never
 * reconstruct.
 *
 * Lives here rather than beside the controller because the browser reads it
 * too: `currentSigilsAtom` / `currentSigilAtom` validate against this schema on
 * every write, and importing it from `SigilController.ts` would pull the
 * repository and the database provider into the client bundle.
 */
export const sigilResourceSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  name: z.string(),
  /** First characters of the token — enough to name it, not to use it. */
  tokenPrefix: z.string(),
  kinds: z.array(z.string()),
  /** Which corner this app's feedback button sits in. Absent = bottom-right. */
  feedbackPosition: z.string().optional(),
  createdAt: z.string(),
  /** Last time this app reported. Absent means never. */
  lastSeenAt: z.string().optional(),
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

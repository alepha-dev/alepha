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
  /**
   * First characters of the token — enough to name it, not to use it.
   */
  tokenPrefix: z.string(),
  kinds: z.array(z.string()),
  /**
   * Which corner this app's feedback button sits in. Absent = bottom-right.
   */
  feedbackPosition: z.string().optional(),
  /**
   * Where this app lives, as its operator pinned it. Absent means "use
   * whatever the app reports" — see {@link lastSeenHost}.
   */
  url: z.string().optional(),
  createdAt: z.string(),
  /**
   * Last time this app reported. Absent means never.
   */
  lastSeenAt: z.string().optional(),
  /**
   * The host the app last reported from. A host, not a URL: the `Host` header
   * carries no scheme.
   *
   * Both halves cross rather than a single resolved address, because the UI
   * needs to tell them apart — the Settings field shows the detected host as
   * its placeholder, which is how an empty field can honestly read as "using
   * the one the app reports" instead of as "unset".
   */
  lastSeenHost: z.string().optional(),
  /**
   * What the app last said it is configured to collect, resolved.
   *
   * Rendered read-only, beside `kinds`, which is what this sink accepts. The
   * point of the pair is that a disagreement is visible: an app sending vitals
   * the sink refuses is currently invisible in both directions.
   *
   * Absent means "this app has not told us" - an older client, or one that has
   * never reported - and must render as unknown, never as off.
   */
  reportedConfig: z
    .object({
      trackers: z.record(z.string(), z.boolean()).optional(),
      feedback: z.boolean().optional(),
      feedbackButton: z.string().optional(),
      feedbackButtonExcludedPaths: z.array(z.string()).optional(),
      reportOutsideProduction: z.boolean().optional(),
    })
    .optional(),
  /**
   * When that config was reported. Its own timestamp rather than `lastSeenAt`,
   * because an app reports constantly and changes its config rarely.
   */
  reportedConfigAt: z.string().optional(),
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

/**
 * What Lore knows about a Cloudflare credential after asking Cloudflare.
 *
 * Three answers, not two. **A transport failure is no verdict**: a network
 * error, a timeout, a `5xx` or a `429` means Lore does not know, and "does
 * not know" must never be written to a row as "invalid", or a Cloudflare
 * outage at midnight would flip every estate at once (#1630).
 */
export type EstateCredentialCheck =
  | { outcome: "passed"; expiresAt?: string }
  | { outcome: "failed"; message: string }
  | { outcome: "inconclusive"; message: string };

/**
 * Everything Lore does with a Cloudflare estate's credential: mask it for a
 * read path, and prove it against the account it names.
 *
 * ⚠️ **The token is an argument, never an environment variable.** It lives
 * as a sealed column, is opened at the moment of use and passed in. There is
 * no `CLOUDFLARE_API_TOKEN` and there is no import from
 * `alepha/cli/platform-lib`: its `CloudflareApi` injects `WranglerApi`,
 * which injects `ShellProvider` and so cannot enter a Worker bundle, and its
 * `resolveAccountId` reads `process.env.CLOUDFLARE_ACCOUNT_ID`, which on
 * Lore's Worker is **Lore's own account**. Importing it would check a user's
 * token against the operator's account.
 *
 * ⚠️ {@link check} is the seam #1630 fills. It answers `passed` today, which
 * is what lets #1629 build the create-and-replace paths around a check that
 * is called in the right place before it can say anything. Nothing else in
 * this class is provisional: the mask and the refusal branches are final.
 */
export class EstateCloudflareService {
  /**
   * How much of a pasted token {@link mask} keeps.
   *
   * The kind marker plus eight characters, which is the bay rule
   * (`EstateTokenService.PREFIX_LENGTH` is `est_` plus eight) applied to a
   * credential Lore did not mint. Eight AFTER the marker and not eight in
   * total: `cfut_` is five characters, so a total of eight would show three
   * characters of the token and name nothing.
   */
  public static readonly MASK_LENGTH_AFTER_MARKER = 8;

  /**
   * The markers Cloudflare puts on a scannable token. A legacy token has
   * none, and is masked by its first eight characters.
   */
  public static readonly TOKEN_MARKERS = ["cfut_", "cfat_"] as const;

  /**
   * The first characters of a token, enough for a person to tell two apart
   * and far too few to reconstruct one.
   */
  mask(token: string): string {
    const marker = EstateCloudflareService.TOKEN_MARKERS.find((it) =>
      token.startsWith(it),
    );
    const kept =
      (marker?.length ?? 0) + EstateCloudflareService.MASK_LENGTH_AFTER_MARKER;
    return token.slice(0, kept);
  }

  /**
   * Proves a token against the account it names.
   *
   * Called before the row is written on a create, before the column changes
   * on a replace, on demand from the owner's drawer, and every night by the
   * sweep (#1630). Nothing is cached: a save is rare and the answer has to
   * be current.
   */
  async check(input: {
    accountId: string;
    token: string;
  }): Promise<EstateCredentialCheck> {
    // #1630 replaces this with the seven probes: identity, then one cheap
    // GET per permission group, every one required. Until then the shape is
    // real and the answer is not, which is deliberate: #1629 wires the
    // callers, #1630 gives them something to hear.
    void input;
    return { outcome: "passed" };
  }
}

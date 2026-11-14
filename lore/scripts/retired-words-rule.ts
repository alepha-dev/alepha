/**
 * The words #E147 retired: blight (now error) and estate (now host).
 *
 * People, agents and code share one vocabulary, so a new `blight` or `estate`
 * anywhere in the repository is refused. What survives does so on purpose,
 * and is listed here:
 *
 * - history: the changelog, committed migrations, and the specs that seed a
 *   database in its pre-#E147 shape to prove a migration;
 * - Bay's wire v1, which every running Bay and every Lore speak, so a new
 *   spelling would need a binary swap on every host: the paths `/ws/estates`,
 *   `/estates/enrol` and `/estates/commands/...`, the `estate` and `estateId`
 *   keys, the `est_` secret prefix, the installer's `LORE_ESTATE_SECRET`, and
 *   the frozen fixtures (`testdata/wire-v1`, Lore's copy under
 *   `test/fixtures/bay`);
 * - stored names a migration cannot move: the credential seal label
 *   `lore:estates:v1`, the `estate-command-results` bucket, and the
 *   `blights` key of an app's `SIGIL_CONFIG`, read by the `@alepha/lore` each
 *   deployed app pinned;
 * - the comments that explain those survivors, which say "wire v1" or name
 *   #E147.
 *
 * A plain `-i estate` would match `useState`, `restate` and every `*State`, so
 * the match is word-bounded: lowercase at a word start, capitalised anywhere.
 *
 * Read by `scripts/check-conventions.ts` over the whole repository; specified
 * by `scripts/retired-words-rule.spec.ts`.
 */
export class RetiredWordsRule {
  public static readonly WORDS =
    /(^|[^a-zA-Z])(blight|estate)|Blight|Estate|BLIGHT|ESTATE/;

  /**
   * Files that may say the old words anywhere: history, frozen wire
   * fixtures, the migration specs, and this rule with its spec.
   */
  public static readonly FILES: RegExp[] = [
    /(^|\/)CHANGELOG\.md$/,
    /(^|\/)migrations\//,
    /(^|\/)testdata\/wire-v1\//,
    /^lore\/packages\/@lore\/ship\/test\/fixtures\/bay\//,
    /^lore\/apps\/lore\/test\/[a-z-]+-become-[a-z-]+-migration\.spec\.ts$/,
    /^lore\/scripts\/retired-words-rule(\.spec)?\.ts$/,
  ];

  /**
   * Substrings that make a line a survivor: the wire, the stored names, and
   * the comments that explain them.
   */
  public static readonly LINES: string[] = [
    "/ws/estates",
    "/estates/enrol",
    "/estates/commands",
    'json:"estate',
    "estateId",
    "LORE_ESTATE_SECRET",
    "lore:estates:v1",
    "estate-command-results",
    "est_",
    // The Bay frames' wire v1 key, where Lore builds, parses or fakes one.
    'welcome["estate"]',
    '"estate":',
    "estate: z.object({ id",
    "estate: { id",
    // An app's SIGIL_CONFIG key, read by the @alepha/lore it pinned.
    "SIGIL_CONFIG",
    "?.blights",
    "`blights`",
    "blights: z.boolean",
    // The sigil settings form, whose fields are the SIGIL_CONFIG keys.
    "blights: {",
    "wire v1",
    "Wire v1",
    "#E147",
  ];

  /**
   * The lines of one file that say a retired word outside the allowlist,
   * as `path:line: text`.
   */
  public check(file: string, source: string): string[] {
    if (RetiredWordsRule.FILES.some((pattern) => pattern.test(file))) {
      return [];
    }
    if (!RetiredWordsRule.WORDS.test(source)) return [];
    const found: string[] = [];
    source.split("\n").forEach((line, index) => {
      if (!RetiredWordsRule.WORDS.test(line)) return;
      if (RetiredWordsRule.LINES.some((allowed) => line.includes(allowed))) {
        return;
      }
      found.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
    });
    return found;
  }
}

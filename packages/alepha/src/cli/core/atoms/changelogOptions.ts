import { $atom, type Infer, z } from "alepha";

/**
 * Default scopes to ignore in changelog generation.
 * Commits with these scopes won't appear in release notes.
 */
export const DEFAULT_IGNORE = [
  "project",
  "release",
  "starter",
  "example",
  "chore",
  "ci",
  "build",
  "test",
  "style",
];

/**
 * Commit types that reach the changelog when none are configured.
 *
 * A release note answers "what changed for me", and only these two ever do.
 * The rest — `refactor`, `chore`, `test`, `style` — are how the change was
 * made, which is what the git history is for.
 */
export const DEFAULT_TYPES = ["feat", "fix"];

/**
 * Changelog configuration atom.
 *
 * Configure in `alepha.config.ts`:
 * ```ts
 * import { changelogOptions } from "alepha/cli";
 *
 * alepha.set(changelogOptions, {
 *   types: ["feat", "fix"],
 *   scopes: ["core", "orm", "server"],
 * });
 * ```
 */
export const changelogOptions = $atom({
  name: "alepha.cli.changelog.options",
  schema: z.object({
    /**
     * Commit types to publish, in the order their sections appear.
     *
     * Defaults to {@link DEFAULT_TYPES}. Listing a type is the only way it
     * reaches the output: `types: ["feat", "fix", "perf"]` adds a Performance
     * section, and dropping `fix` removes Bug Fixes entirely.
     */
    types: z.array(z.string()).optional(),
    /**
     * Scopes to publish — an allowlist. Unset means every scope is published.
     *
     * Prefer this over {@link ignore} for anything that grows. A denylist has
     * to be edited every time a new app, package or scope appears, and the one
     * edit nobody makes is the one that leaks internal work into release
     * notes; an allowlist is closed by construction and stays correct while
     * the repository grows around it.
     *
     * Match is on the scope, or on the segment before the first `/`, so
     * `api` covers `api/users`. A commit carrying several comma-separated
     * scopes is published when any one of them is allowed, and lists only
     * those: `fix(orm,lore)` with `orm` allowed prints as **orm**.
     */
    scopes: z.array(z.string()).optional(),
    /**
     * Scopes to exclude, applied only when {@link scopes} is unset.
     *
     * Note that these are *scopes*, not types: `chore(cli): …` is already gone
     * because `chore` is not in {@link types}, and listing `"chore"` here only
     * ever excludes the unusual `feat(chore): …`.
     */
    ignore: z.array(z.string()).optional(),
  }),
  default: {
    types: DEFAULT_TYPES,
    ignore: DEFAULT_IGNORE,
  },
  serverOnly: true,
});

export type ChangelogOptions = Infer<typeof changelogOptions.schema>;

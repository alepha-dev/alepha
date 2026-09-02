import { $atom, $context, type Infer, z } from "alepha";

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

/**
 * Configure the changelog from `defineConfig`.
 *
 * `defineConfig` has a typed field for `entry`, `services`, `plugins`,
 * `build`, `dev`, `meta` and `env`, and none for an arbitrary atom, so the
 * declarative form had no way to reach {@link changelogOptions}. This plugin
 * is that way. Same shape as `vendor()` and `platform()`, with nothing to
 * register: `gen changelog` lives in `alepha/cli` and is always there, so the
 * only thing to do is set the atom.
 *
 * ```ts
 * import { changelog } from "alepha/cli";
 * import { defineConfig } from "alepha/cli/config";
 *
 * export default defineConfig({
 *   plugins: [changelog({ types: ["feat", "fix"], scopes: ["core", "orm"] })],
 * });
 * ```
 *
 * Runs when the config loads, inside the CLI's `configure` hook, which is the
 * same moment the function form's `alepha.set(changelogOptions, …)` ran. The
 * command reads the atom through `$store`, which re-reads on every access, so
 * the value is in place long before `gen changelog` looks at it either way.
 */
export const changelog = (options: ChangelogOptions) => {
  return () => {
    const { alepha } = $context();
    alepha.set(changelogOptions, options);
  };
};

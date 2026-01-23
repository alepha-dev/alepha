import { $atom, type Static, t } from "alepha";

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
 * Changelog configuration atom.
 *
 * Configure in `alepha.config.ts`:
 * ```ts
 * import { changelogOptions } from "alepha/cli";
 *
 * alepha.set(changelogOptions, {
 *   ignore: ["project", "release", "chore", "docs"],
 * });
 * ```
 */
export const changelogOptions = $atom({
  name: "alepha.cli.changelog.options",
  schema: t.object({
    /**
     * Scopes to ignore (e.g., "project", "release", "chore").
     * Commits like `feat(chore): ...` will be excluded from changelog.
     */
    ignore: t.optional(t.array(t.string())),
  }),
  default: {
    ignore: DEFAULT_IGNORE,
  },
});

export type ChangelogOptions = Static<typeof changelogOptions.schema>;

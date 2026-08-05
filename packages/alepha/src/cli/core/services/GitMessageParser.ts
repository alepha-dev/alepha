import { $logger } from "alepha/logger";
import {
  type ChangelogOptions,
  DEFAULT_IGNORE,
  DEFAULT_TYPES,
} from "../atoms/changelogOptions.ts";
import type { Commit } from "../commands/gen/changelog.ts";

/**
 * Service for parsing git commit messages into structured format.
 *
 * Only parses **conventional commits with a scope**:
 * - `feat(scope): description` → feature
 * - `fix(scope): description` → bug fix
 * - `feat(scope)!: description` → breaking change
 *
 * Commits without scope are ignored, allowing developers to commit
 * work-in-progress changes without polluting release notes:
 * - `cli: work in progress` → ignored (no type)
 * - `fix: quick patch` → ignored (no scope)
 * - `feat(cli): add command` → included
 */
export class GitMessageParser {
  protected readonly log = $logger();

  /**
   * Parse a git commit line into a structured Commit object.
   *
   * **Format:** `type(scope): description` or `type(scope)!: description`
   *
   * **Supported types:** whatever `config.types` lists — `feat` and `fix` by
   * default. The type vocabulary lives in the configuration and nowhere else:
   * this used to accept `docs|refactor|perf|revert` too, which the command
   * then dropped on the floor, so a `perf` commit was parsed and silently lost.
   *
   * **Breaking changes:** Use `!` before `:` (e.g., `feat(api)!: remove endpoint`)
   *
   * @returns Commit object or null if not matching/ignored
   */
  parseCommit(line: string, config: ChangelogOptions): Commit | null {
    // Extract hash and message from git log --oneline format
    const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
    if (!match) return null;

    const [, hash, message] = match;
    const types = config.types ?? DEFAULT_TYPES;

    // Conventional commit with REQUIRED scope: type(scope): description
    // The `!` before `:` marks a breaking change
    const conventionalMatch = message.match(
      /^([a-zA-Z]+)\(([^)]+)\)(!)?:\s*(.+)$/,
    );

    if (!conventionalMatch) {
      // No match - commit doesn't follow required format
      return null;
    }

    const [, rawType, rawScope, breakingMark, description] = conventionalMatch;
    const type = rawType.toLowerCase();

    if (!types.includes(type)) {
      return null;
    }

    const scope = this.resolveScope(rawScope, config);
    if (!scope) {
      return null;
    }

    // Breaking change detection:
    // 1. Explicit `!` marker: feat(api)!: change
    // 2. Word "breaking" in description: feat(api): breaking change to auth
    const breaking =
      breakingMark === "!" || description.toLowerCase().includes("breaking");

    return {
      hash: hash.substring(0, 8),
      type,
      scope,
      description: description.trim(),
      breaking,
    };
  }

  /**
   * Reduce a raw scope to the part worth publishing, or `null` for none.
   *
   * A commit may carry several scopes — `fix(orm,lore)` — and they are judged
   * one at a time, so a change that touched a published module and an internal
   * app is published, naming only the module. Judging the raw string instead
   * let every multi-scope commit through: `"orm,lore"` matches no entry in any
   * list, whichever way the list is meant.
   *
   * Matching is on the scope or on the segment before its first `/`, so `api`
   * covers `api/users` and the full path is what gets printed.
   */
  protected resolveScope(
    rawScope: string,
    config: ChangelogOptions,
  ): string | null {
    const scopes = rawScope
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);

    // An allowlist answers "is this ours to publish", which is a question that
    // stays answerable as the repository grows. It wins when both are set.
    if (config.scopes) {
      const allowed = config.scopes;
      const kept = scopes.filter(
        (scope) =>
          allowed.includes(scope) || allowed.includes(scope.split("/")[0]),
      );
      return kept.length > 0 ? kept.join(",") : null;
    }

    const ignore = config.ignore ?? DEFAULT_IGNORE;
    const kept = scopes.filter(
      (scope) =>
        !ignore.includes(scope) && !ignore.includes(scope.split("/")[0]),
    );

    return kept.length > 0 ? kept.join(",") : null;
  }
}

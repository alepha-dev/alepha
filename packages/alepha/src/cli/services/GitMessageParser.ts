import { $logger } from "alepha/logger";
import {
  type ChangelogOptions,
  DEFAULT_IGNORE,
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
   * **Supported types:** feat, fix, docs, refactor, perf, revert
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
    const ignore = config.ignore ?? DEFAULT_IGNORE;

    // Conventional commit with REQUIRED scope: type(scope): description
    // The `!` before `:` marks a breaking change
    const conventionalMatch = message.match(
      /^(feat|fix|docs|refactor|perf|revert)\(([^)]+)\)(!)?:\s*(.+)$/i,
    );

    if (!conventionalMatch) {
      // No match - commit doesn't follow required format
      return null;
    }

    const [, type, scope, breakingMark, description] = conventionalMatch;

    // Check if scope should be ignored
    const baseScope = scope.split("/")[0];
    if (ignore.includes(baseScope) || ignore.includes(scope)) {
      return null;
    }

    // Breaking change detection:
    // 1. Explicit `!` marker: feat(api)!: change
    // 2. Word "breaking" in description: feat(api): breaking change to auth
    const breaking =
      breakingMark === "!" || description.toLowerCase().includes("breaking");

    return {
      hash: hash.substring(0, 8),
      type: type.toLowerCase(),
      scope,
      description: description.trim(),
      breaking,
    };
  }
}

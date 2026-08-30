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
   * **Breaking changes:** `!` before `:` (e.g. `feat(api)!: remove endpoint`),
   * the word "breaking" in the subject, or a marker in the BODY — see
   * {@link breakingNotes}.
   *
   * @param record One commit: the `--oneline` subject on the first line,
   *   the body on the rest. A bare subject still parses, which is what
   *   keeps every existing caller and spec working.
   * @returns Commit object or null if not matching/ignored
   */
  parseCommit(record: string, config: ChangelogOptions): Commit | null {
    const newline = record.indexOf("\n");
    const line = newline === -1 ? record : record.slice(0, newline);
    const body = newline === -1 ? "" : record.slice(newline + 1);

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
    // 3. A marker in the BODY, which is where both conventional commits and
    //    this repository actually declare them.
    const notes = this.breakingNotes(body);
    const breaking =
      breakingMark === "!" ||
      description.toLowerCase().includes("breaking") ||
      notes.length > 0;

    return {
      hash: hash.substring(0, 8),
      type,
      scope,
      description: description.trim(),
      breaking,
      breakingNotes: notes,
    };
  }

  /**
   * The prose a commit wrote about what it breaks, or an empty list.
   *
   * Two markers, and the second is the one that matters. Conventional
   * commits put breaks behind a `BREAKING CHANGE:` footer; this repository
   * writes a bare `Breaking changes` heading followed by a list, and always
   * has. Over `0.27.0..HEAD` **no commit** carried a `!`, no subject
   * contained the word, and exactly one declared breaks — in the second
   * form. Matching only the footer would have been correct against the
   * specification and useless against the history.
   *
   * Reading stops at the first blank line after the list, so the paragraph
   * a commit adds afterwards ("Also fixes …") does not become a breaking
   * note. Indented lines continue the note above them, because these bodies
   * are hard-wrapped at ~76 columns and a wrapped bullet is one item, not
   * two.
   */
  protected breakingNotes(body: string): string[] {
    if (!body.trim()) return [];

    const lines = body.split("\n");
    const start = lines.findIndex(
      (line) =>
        /^#{0,3}\s*breaking[- ]changes?\s*:?\s*$/i.test(line) ||
        /^BREAKING[ -]CHANGE:/.test(line),
    );
    if (start === -1) return [];

    const notes: string[] = [];

    // The footer form carries its text on the marker line itself.
    const inline = lines[start].match(/^BREAKING[ -]CHANGE:\s*(.+)$/);
    if (inline) notes.push(inline[1].trim());

    for (const line of lines.slice(start + 1)) {
      const item = line.match(/^\s*[-*]\s+(.+)$/);
      if (item) {
        notes.push(item[1].trim());
        continue;
      }
      if (!line.trim()) {
        if (notes.length > 0) break;
        continue;
      }
      if (/^\s+\S/.test(line) && notes.length > 0) {
        notes[notes.length - 1] += ` ${line.trim()}`;
        continue;
      }
      // A new paragraph at column zero: the section is over, unless nothing
      // has been collected yet — then it IS the note (the footer's
      // free-prose form, wrapped onto the next line).
      if (notes.length > 0) break;
      notes.push(line.trim());
    }

    return notes;
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

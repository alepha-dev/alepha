import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { $inject, $store, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import {
  changelogOptions,
  DEFAULT_TYPES,
} from "../../atoms/changelogOptions.ts";
import { GitMessageParser } from "../../services/GitMessageParser.ts";

export {
  type ChangelogOptions,
  changelogOptions,
  DEFAULT_IGNORE,
  DEFAULT_TYPES,
} from "../../atoms/changelogOptions.ts";
export { GitMessageParser } from "../../services/GitMessageParser.ts";

const execFileAsync = promisify(execFile);

// =============================================================================
// GIT PROVIDER
// =============================================================================

/**
 * Git provider for executing git commands.
 * Can be substituted in tests with a mock implementation.
 *
 * Takes an argv array so user-supplied refs (`--from`/`--to`) can never be
 * interpreted by a shell.
 */
export class GitProvider {
  async exec(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout;
  }
}

// =============================================================================
// TYPES
// =============================================================================

export interface Commit {
  hash: string;
  type: string;
  scope: string | null;
  description: string;
  breaking: boolean;
}

interface ChangelogSection {
  type: string;
  title: string;
  commits: Commit[];
}

/**
 * Heading for a commit type. A type with no entry here is titled from its own
 * name, so configuring one that nobody anticipated still produces a section
 * rather than an empty string.
 */
const SECTION_TITLES: Record<string, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  refactor: "Refactors",
  docs: "Documentation",
  revert: "Reverts",
};

// =============================================================================
// CHANGELOG COMMAND
// =============================================================================

/**
 * Changelog command for generating release notes from git commits.
 *
 * Usage:
 * - `alepha gen changelog` - Show unreleased changes since latest tag to HEAD
 * - `alepha gen changelog --from=1.0.0` - Show changes from version to HEAD
 * - `alepha gen changelog --from=1.0.0 --to=1.1.0` - Show changes between two refs
 * - `alepha gen changelog | tee -a CHANGELOG.md` - Append to file
 */
export class ChangelogCommand {
  protected readonly log = $logger();
  protected readonly git = $inject(GitProvider);
  protected readonly parser = $inject(GitMessageParser);
  protected readonly config = $store(changelogOptions);

  // ---------------------------------------------------------------------------
  // FORMATTING
  // ---------------------------------------------------------------------------

  /**
   * Format a single commit line.
   * Example: `- **cli**: add new command (\`abc1234\`)`
   * Breaking changes are flagged: `- **cli**: add new command [BREAKING] (\`abc1234\`)`
   */
  protected formatCommit(commit: Commit): string {
    const breaking = commit.breaking ? " [BREAKING]" : "";
    return `- **${commit.scope}**: ${commit.description}${breaking} (\`${commit.hash}\`)`;
  }

  /**
   * Format the changelog entry with sections, in configured type order.
   */
  protected formatEntry(entry: ChangelogSection[]): string {
    const lines: string[] = [];

    for (const section of entry) {
      if (section.commits.length === 0) continue;

      lines.push(`### ${section.title}\n`);
      for (const commit of section.commits) {
        lines.push(this.formatCommit(commit));
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // PARSING
  // ---------------------------------------------------------------------------

  /**
   * Parse git log output into a changelog entry.
   *
   * One section per configured type, in the order they were configured — the
   * parser has already refused everything else, so a commit that arrives here
   * always has a section to land in.
   */
  protected parseCommits(commitsOutput: string): ChangelogSection[] {
    const types = this.config.types ?? DEFAULT_TYPES;
    const sections: ChangelogSection[] = types.map((type) => ({
      type,
      title: SECTION_TITLES[type] ?? type[0].toUpperCase() + type.slice(1),
      commits: [],
    }));

    for (const line of commitsOutput.trim().split("\n")) {
      if (!line.trim()) continue;

      const commit = this.parser.parseCommit(line, this.config);
      if (!commit) {
        this.log.trace("Skipping commit", { line });
        continue;
      }

      this.log.trace("Parsed commit", { commit });

      // Breaking flag is preserved on the commit itself.
      const section = sections.find((it) => it.type === commit.type);
      section?.commits.push(commit);
    }

    return sections;
  }

  /**
   * Check if entry has any public commits.
   */
  protected hasChanges(entry: ChangelogSection[]): boolean {
    return entry.some((section) => section.commits.length > 0);
  }

  /**
   * Get the latest version tag.
   */
  protected async getLatestTag(
    git: (args: string[]) => Promise<string>,
  ): Promise<string | null> {
    const tagsOutput = await git(["tag", "--sort=-version:refname"]);
    const tags = tagsOutput
      .trim()
      .split("\n")
      .find((tag) => tag.match(/^\d+\.\d+\.\d+$/));

    return tags || null;
  }

  // ---------------------------------------------------------------------------
  // COMMAND
  // ---------------------------------------------------------------------------

  public readonly command = $command({
    name: "changelog",
    description:
      "Generate changelog from conventional commits (outputs to stdout)",
    flags: z.object({
      /**
       * Show changes from this ref (tag, commit, branch).
       * Defaults to the latest version tag.
       * Example: --from=1.0.0
       */
      from: z
        .string()
        .meta({ aliases: ["f"] })
        .describe("Starting ref (default: latest tag)")
        .optional(),
      /**
       * Show changes up to this ref (tag, commit, branch).
       * Defaults to HEAD.
       * Example: --to=main
       */
      to: z
        .string()
        .meta({ aliases: ["t"] })
        .describe("Ending ref (default: HEAD)")
        .optional(),
    }),
    handler: async ({ flags, root }) => {
      const git = (args: string[]) => this.git.exec(args, root);

      // Determine the starting point
      let fromRef: string;

      if (flags.from) {
        // User specified a ref
        fromRef = flags.from;
        this.log.debug("Using specified from ref", { from: fromRef });
      } else {
        // Use latest tag
        const latestTag = await this.getLatestTag(git);
        if (!latestTag) {
          process.stdout.write("No version tags found in repository\n");
          return;
        }
        fromRef = latestTag;
        this.log.debug("Using latest tag", { from: fromRef });
      }

      // Determine the ending point
      const toRef = flags.to || "HEAD";
      this.log.debug("Using to ref", { to: toRef });

      // Get commits in range
      const commitsOutput = await git([
        "log",
        `${fromRef}..${toRef}`,
        "--oneline",
      ]);

      if (!commitsOutput.trim()) {
        process.stdout.write(`No changes in range ${fromRef}..${toRef}\n`);
        return;
      }

      // Parse and format
      const entry = this.parseCommits(commitsOutput);

      if (!this.hasChanges(entry)) {
        process.stdout.write(
          `No public changes in range ${fromRef}..${toRef}\n`,
        );
        return;
      }

      // Output the formatted changelog (no header - caller adds it if needed)
      process.stdout.write(this.formatEntry(entry));
    },
  });
}

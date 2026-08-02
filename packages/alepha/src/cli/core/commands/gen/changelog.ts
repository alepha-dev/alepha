import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { $inject, $store, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { changelogOptions } from "../../atoms/changelogOptions.ts";
import { GitMessageParser } from "../../services/GitMessageParser.ts";

export {
  type ChangelogOptions,
  changelogOptions,
  DEFAULT_IGNORE,
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

interface ChangelogEntry {
  features: Commit[];
  fixes: Commit[];
}

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
   * Format the changelog entry with sections.
   */
  protected formatEntry(entry: ChangelogEntry): string {
    const sections: string[] = [];

    if (entry.features.length > 0) {
      sections.push("### Features\n");
      for (const commit of entry.features) {
        sections.push(this.formatCommit(commit));
      }
      sections.push("");
    }

    if (entry.fixes.length > 0) {
      sections.push("### Bug Fixes\n");
      for (const commit of entry.fixes) {
        sections.push(this.formatCommit(commit));
      }
      sections.push("");
    }

    return sections.join("\n");
  }

  // ---------------------------------------------------------------------------
  // PARSING
  // ---------------------------------------------------------------------------

  /**
   * Parse git log output into a changelog entry.
   */
  protected parseCommits(commitsOutput: string): ChangelogEntry {
    const entry: ChangelogEntry = {
      features: [],
      fixes: [],
    };

    for (const line of commitsOutput.trim().split("\n")) {
      if (!line.trim()) continue;

      const commit = this.parser.parseCommit(line, this.config);
      if (!commit) {
        this.log.trace("Skipping commit", { line });
        continue;
      }

      this.log.trace("Parsed commit", { commit });

      // Categorize commit (breaking flag is preserved on the commit itself)
      if (commit.type === "feat") {
        entry.features.push(commit);
      } else if (commit.type === "fix") {
        entry.fixes.push(commit);
      }
    }

    return entry;
  }

  /**
   * Check if entry has any public commits.
   */
  protected hasChanges(entry: ChangelogEntry): boolean {
    return entry.features.length > 0 || entry.fixes.length > 0;
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
      .filter((tag) => tag.match(/^\d+\.\d+\.\d+$/));

    return tags[0] || null;
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

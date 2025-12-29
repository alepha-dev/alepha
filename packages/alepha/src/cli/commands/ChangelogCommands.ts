import { exec } from "node:child_process";
import { promisify } from "node:util";
import { $inject, $use, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { changelogOptions } from "../atoms/changelogOptions.ts";
import { GitMessageParser } from "../services/GitMessageParser.ts";

export {
  type ChangelogOptions,
  changelogOptions,
  DEFAULT_IGNORE,
} from "../atoms/changelogOptions.ts";
export { GitMessageParser } from "../services/GitMessageParser.ts";

const execAsync = promisify(exec);

// =============================================================================
// GIT PROVIDER
// =============================================================================

/**
 * Git provider for executing git commands.
 * Can be substituted in tests with a mock implementation.
 */
export class GitProvider {
  async exec(cmd: string, cwd: string): Promise<string> {
    const { stdout } = await execAsync(`git ${cmd}`, { cwd });
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
  breaking: Commit[];
}

// =============================================================================
// CHANGELOG COMMANDS
// =============================================================================

/**
 * Changelog command for generating release notes from git commits.
 *
 * Usage:
 * - `alepha changelog` - Show unreleased changes since latest tag
 * - `alepha changelog --from=1.0.0` - Show changes from version to HEAD
 * - `alepha changelog > CHANGELOG.md` - Pipe to file
 */
export class ChangelogCommands {
  protected readonly log = $logger();
  protected readonly git = $inject(GitProvider);
  protected readonly parser = $inject(GitMessageParser);
  protected readonly config = $use(changelogOptions);

  // ---------------------------------------------------------------------------
  // FORMATTING
  // ---------------------------------------------------------------------------

  /**
   * Format a single commit line.
   * Example: `- **cli**: add new command (\`abc1234\`)`
   */
  protected formatCommit(commit: Commit): string {
    return `- **${commit.scope}**: ${commit.description} (\`${commit.hash}\`)`;
  }

  /**
   * Format the changelog entry with sections.
   */
  protected formatEntry(entry: ChangelogEntry): string {
    const sections: string[] = [];

    if (entry.breaking.length > 0) {
      sections.push("### Breaking Changes\n");
      for (const commit of entry.breaking) {
        sections.push(this.formatCommit(commit));
      }
      sections.push("");
    }

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
      breaking: [],
    };

    for (const line of commitsOutput.trim().split("\n")) {
      if (!line.trim()) continue;

      const commit = this.parser.parseCommit(line, this.config);
      if (!commit) {
        this.log.trace("Skipping commit", { line });
        continue;
      }

      this.log.trace("Parsed commit", { commit });

      // Categorize commit
      if (commit.breaking) {
        entry.breaking.push(commit);
      }
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
    return (
      entry.features.length > 0 ||
      entry.fixes.length > 0 ||
      entry.breaking.length > 0
    );
  }

  /**
   * Get the latest version tag.
   */
  protected async getLatestTag(
    git: (cmd: string) => Promise<string>,
  ): Promise<string | null> {
    const tagsOutput = await git("tag --sort=-version:refname");
    const tags = tagsOutput
      .trim()
      .split("\n")
      .filter((tag) => tag.match(/^\d+\.\d+\.\d+$/));

    return tags[0] || null;
  }

  // ---------------------------------------------------------------------------
  // COMMAND
  // ---------------------------------------------------------------------------

  public readonly changelog = $command({
    name: "changelog",
    description: "Show changelog (outputs to stdout, pipe to file if needed)",
    flags: t.object({
      /**
       * Show changes from this version to HEAD.
       * Example: --from=1.0.0
       */
      from: t.optional(
        t.string({
          aliases: ["f"],
          description: "Show changes from this version to HEAD",
        }),
      ),
    }),
    handler: async ({ flags, root }) => {
      const git = (cmd: string) => this.git.exec(cmd, root);

      // Determine the starting point
      let fromVersion: string;

      if (flags.from) {
        // User specified a version
        fromVersion = flags.from;
        this.log.debug("Using specified version", { from: fromVersion });
      } else {
        // Use latest tag
        const latestTag = await this.getLatestTag(git);
        if (!latestTag) {
          console.log("No version tags found in repository");
          return;
        }
        fromVersion = latestTag;
        this.log.debug("Using latest tag", { from: fromVersion });
      }

      // Get commits from version to HEAD
      const commitsOutput = await git(`log ${fromVersion}..HEAD --oneline`);

      if (!commitsOutput.trim()) {
        console.log(`No changes since ${fromVersion}`);
        return;
      }

      // Parse and format
      const entry = this.parseCommits(commitsOutput);

      if (!this.hasChanges(entry)) {
        console.log(`No public changes since ${fromVersion}`);
        return;
      }

      // Output to stdout
      console.log(`## Changes since ${fromVersion}\n`);
      console.log(this.formatEntry(entry));
    },
  });
}

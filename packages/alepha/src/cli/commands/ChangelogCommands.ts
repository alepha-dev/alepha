import { exec } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { t } from "alepha";
import { $command } from "alepha/command";

const execAsync = promisify(exec);

interface Commit {
  hash: string;
  type: string;
  scope: string | null;
  description: string;
  breaking: boolean;
}

interface ChangelogEntry {
  version: string;
  date: string;
  features: Commit[];
  fixes: Commit[];
  docs: Commit[];
  improvements: Commit[];
  breaking: Commit[];
}

interface ChangelogConfig {
  /**
   * Commit prefixes to ignore (e.g., "project", "release", "chore")
   */
  ignore?: string[];
  /**
   * Module scopes to recognize (e.g., "ui", "cli", "core")
   * If not provided, all non-ignored scopes are included
   */
  scopes?: string[];
}

const DEFAULT_IGNORE = [
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

function parseCommit(line: string, config: ChangelogConfig): Commit | null {
  const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
  if (!match) return null;

  const [, hash, message] = match;
  const breaking =
    message.includes("!:") || message.toLowerCase().includes("breaking");
  const ignore = config.ignore ?? DEFAULT_IGNORE;

  // Conventional commit: feat(scope): description or feat!: description
  const conventionalMatch = message.match(
    /^(feat|fix|docs|refactor|perf|revert)(?:\(([^)]+)\))?!?:\s*(.+)$/i,
  );
  if (conventionalMatch) {
    const [, type, scope, description] = conventionalMatch;

    // Skip if scope matches ignore list
    if (scope) {
      const baseScope = scope.split("/")[0];
      if (ignore.includes(baseScope) || ignore.includes(scope)) {
        return null;
      }
    }

    // Skip if type (without scope) matches ignore list (e.g., "docs" in ignore)
    if (!scope && ignore.includes(type.toLowerCase())) {
      return null;
    }

    return {
      hash: hash.substring(0, 8),
      type: type.toLowerCase(),
      scope: scope || null,
      description: description.trim(),
      breaking,
    };
  }

  // Module-specific commit: module: description or module/submodule: description
  const moduleMatch = message.match(
    /^([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?):\s*(.+)$/i,
  );
  if (moduleMatch) {
    const [, module, description] = moduleMatch;
    const baseModule = module.split("/")[0];

    // Skip ignored prefixes
    if (ignore.includes(baseModule)) {
      return null;
    }

    // If scopes are defined, check if this is a known scope
    if (config.scopes && !config.scopes.includes(baseModule)) {
      return null;
    }

    // Determine type based on description keywords
    const desc = description.toLowerCase();
    let type = "improve";
    if (
      desc.includes("fix") ||
      desc.includes("bug") ||
      desc.includes("issue")
    ) {
      type = "fix";
    } else if (
      desc.includes("add") ||
      desc.includes("new") ||
      desc.includes("implement")
    ) {
      type = "feat";
    }

    return {
      hash: hash.substring(0, 8),
      type,
      scope: module,
      description: description.trim(),
      breaking,
    };
  }

  return null;
}

function formatCommit(commit: Commit): string {
  const scope = commit.scope ? `**${commit.scope}**: ` : "";
  return `- ${scope}${commit.description} (\`${commit.hash}\`)`;
}

function generateChangelog(entries: ChangelogEntry[]): string {
  let output = "# Changelog\n\n";
  output +=
    "All notable changes to this project will be documented in this file.\n\n";

  for (const entry of entries) {
    output += `## [${entry.version}] - ${entry.date}\n\n`;
    output += formatEntry(entry);
  }

  return output;
}

function formatEntry(entry: ChangelogEntry): string {
  let output = "";

  if (entry.breaking.length > 0) {
    output += "### Breaking Changes\n\n";
    for (const commit of entry.breaking) {
      output += `${formatCommit(commit)}\n`;
    }
    output += "\n";
  }

  if (entry.features.length > 0) {
    output += "### Features\n\n";
    for (const commit of entry.features) {
      output += `${formatCommit(commit)}\n`;
    }
    output += "\n";
  }

  if (entry.fixes.length > 0) {
    output += "### Bug Fixes\n\n";
    for (const commit of entry.fixes) {
      output += `${formatCommit(commit)}\n`;
    }
    output += "\n";
  }

  return output;
}

async function loadConfig(root: string): Promise<ChangelogConfig> {
  try {
    const pkgPath = join(root, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    return pkg.changelog ?? {};
  } catch {
    return {};
  }
}

export class ChangelogCommands {
  public readonly changelog = $command({
    name: "changelog",
    description: "Generate CHANGELOG.md from git commits",
    flags: t.object({
      release: t.optional(
        t.boolean({
          when: ["--release", "-r"],
          description:
            "Output release notes for the latest version only (for GitHub Release)",
        }),
      ),
      preview: t.optional(
        t.boolean({
          when: ["--preview", "-p"],
          description: "Preview unreleased changes (commits since last tag)",
        }),
      ),
      output: t.optional(
        t.string({
          when: ["--output", "-o"],
          description:
            "Output file path (defaults to CHANGELOG.md, use - for stdout)",
        }),
      ),
      limit: t.optional(
        t.number({
          when: ["--limit", "-l"],
          description: "Limit number of versions to include",
        }),
      ),
    }),
    handler: async ({ flags, run, root }) => {
      const config = await loadConfig(root);

      const git = async (cmd: string) => {
        const { stdout } = await execAsync(`git ${cmd}`, { cwd: root });
        return stdout;
      };

      // Get all tags sorted by version
      const tagsOutput = await git("tag --sort=-version:refname");
      const tags = tagsOutput
        .trim()
        .split("\n")
        .filter((tag) => tag.match(/^\d+\.\d+\.\d+$/));

      if (tags.length === 0) {
        throw new Error("No version tags found");
      }

      // Preview mode: show unreleased changes
      if (flags.preview) {
        const latestTag = tags[0];
        const commitsOutput = await git(`log ${latestTag}..HEAD --oneline`);

        if (!commitsOutput.trim()) {
          console.log("No unreleased changes since", latestTag);
          return;
        }

        const entry: ChangelogEntry = {
          version: "Unreleased",
          date: new Date().toISOString().split("T")[0],
          features: [],
          fixes: [],
          docs: [],
          improvements: [],
          breaking: [],
        };

        for (const line of commitsOutput.trim().split("\n")) {
          if (!line.trim()) continue;
          const commit = parseCommit(line, config);
          if (!commit) continue;

          if (commit.breaking) entry.breaking.push(commit);

          switch (commit.type) {
            case "feat":
              entry.features.push(commit);
              break;
            case "fix":
              entry.fixes.push(commit);
              break;
            case "docs":
              entry.docs.push(commit);
              break;
            case "refactor":
            case "perf":
            case "improve":
              entry.improvements.push(commit);
              break;
          }
        }

        const hasCommits =
          entry.features.length > 0 ||
          entry.fixes.length > 0 ||
          entry.breaking.length > 0;

        if (!hasCommits) {
          console.log("No public changes since", latestTag);
          return;
        }

        console.log(`## [Unreleased] - since ${latestTag}\n`);
        console.log(formatEntry(entry));
        return;
      }

      const entries: ChangelogEntry[] = [];
      const limit = flags.limit || (flags.release ? 1 : tags.length);

      for (let i = 0; i < Math.min(limit, tags.length); i++) {
        const tag = tags[i];
        const prevTag = tags[i + 1];

        // Get tag date
        const dateOutput = await git(`log -1 --format=%ci ${tag}`);
        const date = dateOutput.trim().split(" ")[0];

        // Get commits between tags
        const range = prevTag ? `${prevTag}..${tag}` : tag;
        const commitsOutput = await git(`log ${range} --oneline`);

        const entry: ChangelogEntry = {
          version: tag,
          date,
          features: [],
          fixes: [],
          docs: [],
          improvements: [],
          breaking: [],
        };

        for (const line of commitsOutput.trim().split("\n")) {
          if (!line.trim()) continue;
          const commit = parseCommit(line, config);
          if (!commit) continue;

          if (commit.breaking) entry.breaking.push(commit);

          switch (commit.type) {
            case "feat":
              entry.features.push(commit);
              break;
            case "fix":
              entry.fixes.push(commit);
              break;
            case "docs":
              entry.docs.push(commit);
              break;
            case "refactor":
            case "perf":
            case "improve":
              entry.improvements.push(commit);
              break;
          }
        }

        // Only add entry if it has any commits
        const hasCommits =
          entry.features.length > 0 ||
          entry.fixes.length > 0 ||
          entry.breaking.length > 0;

        if (hasCommits) {
          entries.push(entry);
        }
      }

      if (entries.length === 0) {
        console.log("No public commits found");
        return;
      }

      let output: string;
      if (flags.release) {
        output = formatEntry(entries[0]);
      } else {
        output = generateChangelog(entries);
      }

      const outputPath = flags.output ?? "CHANGELOG.md";
      if (outputPath === "-") {
        console.log(output);
      } else {
        await run(`Writing ${outputPath}`, () =>
          writeFile(join(root, outputPath), output, "utf8"),
        );
      }
    },
  });
}

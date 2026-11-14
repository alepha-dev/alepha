import { AlephaLoreCli } from "@alepha/lore/cli";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { McpServerProvider } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The rule in `lore/AGENTS.md`: what MCP can do, the CLI can do. The CLI may
 * have more (it moves file bytes, MCP cannot), MCP never.
 *
 * Every `$tool` has to resolve to a `$command` by the naming rule the help
 * teaches: `quest_create` is `lore quest create`. A tool whose command has
 * another name says so in {@link ALIASES}.
 *
 * {@link GAPS} is the debt the rule was written over, and it only shrinks: a
 * new tool cannot join it without someone deciding to write that line, and
 * an entry that gains its command fails here until it is removed.
 */
const SUBJECTS: Record<string, string> = {
  app: "apps",
  artifact: "artifacts",
  release: "releases",
};

const ALIASES: Record<string, string> = {
  // These two move no bytes: they hand back this command line.
  quest_attachment_add: "attachments push",
  folio_attachment_add: "attachments push",
  deploy_start: "deploy",
  epic_set_status: "epic set status",
};

const GAPS: string[] = [];

/**
 * The params a command takes as its positional argument: the reference it
 * acts on.
 */
const POSITIONAL = new Set([
  "id",
  "shortId",
  "number",
  "error_id",
  "monitor_id",
  "key",
  "policy",
  "query",
  "name",
  "folio_shortId",
  "attachment_shortId",
  "directory_shortId",
  "service",
  "section",
  "estate",
]);

/**
 * The params that have no flag, each for a reason.
 */
const NOT_A_FLAG: Record<string, string[]> = {
  // The tool drops the caller's own events by the session's user; nothing
  // tells a CLI process who it is, so the command keeps them (#F1437).
  project_activity: ["includeOwn"],
  // A row's body, opt-in because a tool result is a token budget.
  // `--output json` already prints the whole row.
  quest_list: ["detail"],
  // The deprecated alias of `app`.
  sigil_create: ["name"],
  // The command waits for the machine itself, so it has no second call.
  stack_logs: ["stack", "request"],
  // `--name`, the flag every stack command has; `--to` for the revision.
  stack_get: ["stack"],
  stack_deploy: ["stack"],
  stack_rollback: ["stack", "revision"],
  // `--parent`, as on `directory create`.
  directory_move: ["new_parent_shortId"],
  // One flag per key instead (#Q3591): `--expect-status`, `--keyword`,
  // `--latency-budget`, `--cert-warning-days`, `--email`, `--recipient`.
  monitor_create: ["expect", "notifications"],
  monitor_update: ["expect", "notifications"],
};

const tools = (): any[] => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  bootLore(alepha, ["api", "mcp"]);
  return alepha.inject(McpServerProvider).getTools();
};

const toolNames = (): string[] => tools().map((tool) => tool.name);

const commands = () => {
  const cli = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with(AlephaLoreCli);
  return cli.primitives<any>("$command");
};

/**
 * The words of a tool's name, read against the command tree: an underscore
 * is a space, and a subject's name may differ from the tool's.
 */
const commandOf = (tool: string, all: any[]): any => {
  const [subject, ...verbs] = (
    ALIASES[tool] ?? tool.replaceAll("_", " ")
  ).split(" ");
  const name = SUBJECTS[subject] ?? subject;
  let found = all.find(
    (command) =>
      command.name === name && (verbs.length === 0 || command.hasChildren),
  );
  for (const verb of verbs) {
    found = found?.children.find((child: any) => child.name === verb);
  }
  return found;
};

const hasCommand = (tool: string, all: any[]): boolean =>
  !!commandOf(tool, all);

/**
 * A param and a flag are the same word once its case, separators, plural and
 * the kind of id it names are gone: `dependsOn_shortId` is `--depends-on`,
 * `release_tag` is `--release`, `tags` is `--tag`.
 */
const stem = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[-_]/g, "")
    .replace(/(shortid|number|tag|id)$/, (kind, _name, _at, whole) =>
      whole === kind ? kind : "",
    )
    .replace(/s$/, "");

describe("MCP and the CLI", () => {
  it("gives every tool a command, the gaps named below aside", () => {
    const all = commands();
    const tools = toolNames();

    // Over an empty list the assertion below proves nothing.
    expect(tools.length).toBeGreaterThan(90);

    const missing = tools.filter(
      (tool) => !GAPS.includes(tool) && !hasCommand(tool, all),
    );

    expect(missing).toEqual([]);
  });

  it("gives every param of a tool a flag, or says why not", () => {
    const all = commands();
    const missing: string[] = [];

    for (const tool of tools()) {
      if (ALIASES[tool.name]?.startsWith("attachments")) continue;
      const command = commandOf(tool.name, all);
      const flags = new Set(Object.keys(command?.flags.shape ?? {}).map(stem));
      const takesArg = !!command?.options.args;

      const params = Object.keys(tool.options.schema?.params?.shape ?? {});
      for (const param of params) {
        if (param === "project_name") continue;
        if (flags.has(stem(param))) continue;
        if (takesArg && POSITIONAL.has(param)) continue;
        if (NOT_A_FLAG[tool.name]?.includes(param)) continue;
        missing.push(`${tool.name}.${param}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("has no gap left that a command already closes, or that names no tool", () => {
    const all = commands();
    const tools = toolNames();

    expect(GAPS.filter((tool) => hasCommand(tool, all))).toEqual([]);
    expect(GAPS.filter((tool) => !tools.includes(tool))).toEqual([]);
  });
});

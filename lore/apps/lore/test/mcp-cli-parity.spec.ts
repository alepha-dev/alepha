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
 * The rule in `lore/CLAUDE.md`: what MCP can do, the CLI can do. The CLI may
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
  release: "releases",
};

const ALIASES: Record<string, string> = {
  // These two move no bytes: they hand back this command line.
  quest_attachment_add: "attachments push",
  folio_attachment_add: "attachments push",
  deploy_start: "deploy",
  epic_set_status: "epic set status",
};

const GAPS = [
  "app_instance_create",
  "app_instance_delete",
  "app_instance_get",
  "app_instance_list",
  "app_instance_update",
  "artifact_get",
  "artifact_list",
  "automation_adopt",
  "automation_adoption_preview",
  "automation_catalog",
  "automation_create",
  "automation_delete",
  "automation_get",
  "automation_list",
  "automation_runs",
  "automation_test",
  "automation_update",
  "automation_variable_delete",
  "automation_variable_dependents",
  "automation_variable_list",
  "automation_variable_set",
  "blight_forward",
  "blight_list",
  "blight_resolve",
  "deploy_rollback",
  "deploy_status",
  "feedback_accept",
  "feedback_attachment_get",
  "feedback_comment_add",
  "feedback_get",
  "feedback_list",
  "feedback_reject",
  "insights_read",
  "project_merge",
  "release_attach",
  "release_create",
  "release_delete",
  "release_detach",
  "release_get",
  "release_list",
  "release_reopen",
  "release_set_default",
  "release_update",
  "sigil_create",
  "sigil_delete",
  "sigil_list",
  "sigil_rotate",
  "stack_get",
];

const toolNames = (): string[] => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  bootLore(alepha, ["api", "mcp"]);
  return alepha
    .inject(McpServerProvider)
    .getTools()
    .map((tool) => tool.name)
    .sort();
};

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
const hasCommand = (tool: string, all: any[]): boolean => {
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
  return !!found;
};

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

  it("has no gap left that a command already closes, or that names no tool", () => {
    const all = commands();
    const tools = toolNames();

    expect(GAPS.filter((tool) => hasCommand(tool, all))).toEqual([]);
    expect(GAPS.filter((tool) => !tools.includes(tool))).toEqual([]);
  });
});

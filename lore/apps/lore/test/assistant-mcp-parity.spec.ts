import { McpServerProvider } from "alepha/mcp";
import { describe, it } from "vitest";

import { LoreAiToolset } from "@/assistant/index.ts";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

/**
 * The chat agents' tools against the MCP's (#Q4297): every MCP tool is
 * either offered to a chat agent or listed in `LoreAiToolset.EXCLUDED`
 * with the reason it is not, so a new `$tool` fails here until someone
 * decides.
 */
describe("the chat agent toolset against the MCP", () => {
  const boot = async () => {
    const ctx = await bootAssistant({ enabled: "1" });
    const mcp = ctx.alepha
      .inject(McpServerProvider)
      .getTools()
      .map((tool) => tool.name);
    const toolset = ctx.alepha.inject(LoreAiToolset);
    const offered = toolset.projectScoped.map((entry) => toolset.nameOf(entry));
    return { mcp, offered };
  };

  it("offers or excludes, with a reason, every MCP tool", async ({
    expect,
  }) => {
    const { mcp, offered } = await boot();
    const undecided = mcp.filter(
      (name) => !offered.includes(name) && !(name in LoreAiToolset.EXCLUDED),
    );
    expect(undecided).toEqual([]);
  });

  it("excludes only real MCP tools, none of them offered, each with its reason", async ({
    expect,
  }) => {
    const { mcp, offered } = await boot();
    const excluded = Object.keys(LoreAiToolset.EXCLUDED);
    expect(excluded.filter((name) => !mcp.includes(name))).toEqual([]);
    expect(excluded.filter((name) => offered.includes(name))).toEqual([]);
    for (const reason of Object.values(LoreAiToolset.EXCLUDED)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

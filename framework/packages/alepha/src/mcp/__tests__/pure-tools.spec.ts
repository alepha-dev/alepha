import { $inject, Alepha, type AppSurface, z } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  $tool,
  AlephaMcp,
  LEGACY_PROTOCOL_VERSIONS,
  MODERN_PROTOCOL_VERSIONS,
  McpServerProvider,
} from "../index.ts";

/**
 * Pure tool classes are created on the first MCP request (#Q3406): one
 * request pays for the whole MCP surface, and no cron or plain HTTP request
 * ever does.
 */
let created: string[] = [];

class QuestApi {
  constructor() {
    created.push("QuestApi");
  }
  list = $action({
    method: "GET",
    path: "/quests",
    handler: () => "quests",
  });
}

class QuestTools {
  api = $inject(QuestApi);
  constructor() {
    created.push("QuestTools");
  }
  quest_list = $tool({
    description: "List quests",
    schema: { result: z.text() },
    handler: async () => "quests",
  });
}

class SearchApi {
  constructor() {
    created.push("SearchApi");
  }
  search = $action({
    method: "GET",
    path: "/search",
    description: "Search everything",
    mcp: true,
    handler: () => "found",
  });
}

const surface: AppSurface = {
  version: 1,
  classes: [
    { key: "QuestApi", pure: true },
    { key: "QuestTools", pure: true },
    { key: "SearchApi", pure: true },
  ],
  actions: [
    { name: "list", group: "QuestApi", method: "GET", path: "/quests", class: "QuestApi" },
    {
      name: "search",
      group: "SearchApi",
      method: "GET",
      path: "/search",
      mcp: true,
      class: "SearchApi",
    },
  ],
  routes: [],
  pages: [],
  jobs: [],
  tools: [{ name: "quest_list", class: "QuestTools" }],
  resources: [],
  prompts: [],
};

const boot = async (opts: { mcp?: boolean } = {}) => {
  created = [];
  const alepha = Alepha.create({ env: { SERVER_PORT: 0 } }).useSurface(surface);
  alepha.with(AlephaServer);
  if (opts.mcp !== false) {
    alepha.with(AlephaMcp);
  }
  alepha.with(QuestApi).with(QuestTools).with(SearchApi);
  await alepha.start();
  return alepha;
};

const names = (response: any): string[] =>
  (response?.result?.tools ?? []).map((it: { name: string }) => it.name).sort();

describe("pure MCP tool classes", () => {
  it("are not created at boot, nor by a plain HTTP request", async ({
    expect,
  }) => {
    const alepha = await boot();
    expect(created).toEqual([]);
    const host = alepha.inject(ServerProvider).hostname;
    expect(await (await fetch(`${host}/api/quests`)).text()).toBe("quests");
    expect(created).toEqual(["QuestApi"]);
    await alepha.stop();
  });

  it("are all created by the first MCP request, once, the mcp action's controller with them", async ({
    expect,
  }) => {
    const alepha = await boot();
    const mcp = alepha.inject(McpServerProvider);
    mcp.protocolVersions = [...LEGACY_PROTOCOL_VERSIONS];

    const first = await mcp.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const second = await mcp.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(names(first)).toEqual(["quest_list", "search"]);
    expect(names(second)).toEqual(["quest_list", "search"]);
    expect([...created].sort()).toEqual(["QuestApi", "QuestTools", "SearchApi"]);

    const call = await mcp.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "quest_list", arguments: {} },
    });
    expect(JSON.stringify(call?.result)).toContain("quests");
    await alepha.stop();
  });

  it("answer a modern request the same way", async ({ expect }) => {
    const alepha = await boot();
    const mcp = alepha.inject(McpServerProvider);
    mcp.protocolVersions = [
      ...MODERN_PROTOCOL_VERSIONS,
      ...LEGACY_PROTOCOL_VERSIONS,
    ];
    const response = await mcp.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSIONS[0],
          "io.modelcontextprotocol/clientInfo": { name: "spec", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    expect(names(response)).toEqual(["quest_list", "search"]);
    await alepha.stop();
  });

  it("are created at boot when no MCP server is registered to create them", async ({
    expect,
  }) => {
    const alepha = await boot({ mcp: false });
    expect(created).toContain("QuestTools");
    await alepha.stop();
  });
});

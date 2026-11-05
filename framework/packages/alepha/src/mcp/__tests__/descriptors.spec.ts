import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  $prompt,
  $resource,
  $resourceTemplate,
  AlephaMcp,
  MCP_LEGACY_PROTOCOL_VERSION,
  McpServerProvider,
} from "../index.ts";

/**
 * `instructions`, the full `Implementation` shape, `size` on resource
 * descriptors and `title` on prompt arguments (2026-07-28 schema).
 */

const MODERN = "2026-07-28";
const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "modern", version: "2.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

class Server {
  readme = $resource({
    uri: "docs://readme",
    size: 1234,
    handler: async () => ({ text: "# Hello" }),
  });

  bare = $resource({
    uri: "docs://bare",
    handler: async () => ({ text: "" }),
  });

  folio = $resourceTemplate({
    uriTemplate: "folio://{id}",
    variables: z.object({ id: z.text() }),
    size: 42,
    handler: async ({ variables }) => ({ text: `folio ${variables.id}` }),
  });

  greet = $prompt({
    description: "Greet someone",
    args: z.object({
      who: z.text({ title: "Who", description: "The person to greet" }),
      tone: z.text().optional(),
    }),
    handler: async ({ args }) => [{ role: "user", content: `Hi ${args.who}` }],
  });
}

const setup = () => {
  const alepha = Alepha.create().with(AlephaMcp).with(Server);
  return { alepha, mcp: alepha.inject(McpServerProvider) };
};

const call = async (
  mcp: McpServerProvider,
  method: string,
  params: Record<string, unknown> = {},
) => {
  const res = await mcp.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
  return res?.result as Record<string, any>;
};

describe("McpServerProvider: instructions", () => {
  it("omits instructions when none are set", async () => {
    const { mcp } = setup();
    const discover = await call(mcp, "server/discover", { _meta: modernMeta });
    const init = await call(mcp, "initialize", {
      protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "c", version: "1" },
    });
    expect(discover).not.toHaveProperty("instructions");
    expect(init).not.toHaveProperty("instructions");
  });

  it("sends instructions on server/discover and on initialize", async () => {
    const { mcp } = setup();
    mcp.instructions = "Start with project_context.";
    const discover = await call(mcp, "server/discover", { _meta: modernMeta });
    const init = await call(mcp, "initialize", {
      protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "c", version: "1" },
    });
    expect(discover.instructions).toBe("Start with project_context.");
    expect(init.instructions).toBe("Start with project_context.");
  });

  it("carries title, icons and websiteUrl of serverInfo on the wire", async () => {
    const { mcp } = setup();
    mcp.serverInfo = {
      name: "lore",
      title: "Lore",
      version: "0.36.0",
      websiteUrl: "https://lore.example",
      icons: [{ src: "https://lore.example/icon.svg", sizes: ["any"] }],
    };
    const init = await call(mcp, "initialize", {
      protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "c", version: "1" },
    });
    expect(init.serverInfo).toEqual(mcp.serverInfo);
    const list = await call(mcp, "tools/list", { _meta: modernMeta });
    expect(list._meta["io.modelcontextprotocol/serverInfo"]).toEqual(
      mcp.serverInfo,
    );
  });
});

describe("McpServerProvider: descriptor fields", () => {
  it("advertises size on resources and resource templates when declared", async () => {
    const { mcp } = setup();
    const resources = await call(mcp, "resources/list");
    const templates = await call(mcp, "resources/templates/list");
    const readme = resources.resources.find(
      (r: any) => r.uri === "docs://readme",
    );
    const bare = resources.resources.find((r: any) => r.uri === "docs://bare");
    expect(readme.size).toBe(1234);
    expect(bare).not.toHaveProperty("size");
    expect(templates.resourceTemplates[0].size).toBe(42);
  });

  it("carries a prompt argument's title from its schema", async () => {
    const { mcp } = setup();
    const prompts = await call(mcp, "prompts/list");
    expect(prompts.prompts[0].arguments).toEqual([
      {
        name: "who",
        title: "Who",
        description: "The person to greet",
        required: true,
      },
      { name: "tone", description: undefined, required: false },
    ]);
  });
});

import { Alepha } from "alepha";
import { AlephaMcp, McpServerProvider } from "alepha/mcp";
import { describe, it } from "vitest";

import { LoreMcpIdentity } from "../src/mcp/services/LoreMcpIdentity.ts";

/**
 * Lore introduces itself as Lore, not as the framework default
 * `alepha-mcp 1.0.0` (#Q3052), and tells an agent where to start.
 */
describe("LoreMcpIdentity", () => {
  it("sets serverInfo from the release version and PUBLIC_URL", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { PUBLIC_URL: "https://lore.example/" },
    })
      .with(AlephaMcp)
      .with(LoreMcpIdentity);
    await alepha.start();
    const mcp = alepha.inject(McpServerProvider);
    expect(mcp.serverInfo).toEqual({
      name: "lore",
      title: "Lore",
      version: alepha.meta.version,
      websiteUrl: "https://lore.example",
      icons: [
        {
          src: "https://lore.example/logo-512x512-light.png",
          mimeType: "image/png",
          sizes: ["512x512"],
          theme: "light",
        },
        {
          src: "https://lore.example/logo-512x512.png",
          mimeType: "image/png",
          sizes: ["512x512"],
          theme: "dark",
        },
      ],
    });
    expect(mcp.instructions).toContain("project_context");
    await alepha.stop();
  });

  it("keeps the instructions under 2 KB and omits websiteUrl and icons without PUBLIC_URL", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { PUBLIC_URL: "" } })
      .with(AlephaMcp)
      .with(LoreMcpIdentity);
    await alepha.start();
    const mcp = alepha.inject(McpServerProvider);
    expect(mcp.serverInfo).not.toHaveProperty("websiteUrl");
    expect(mcp.serverInfo).not.toHaveProperty("icons");
    expect(new TextEncoder().encode(mcp.instructions).length).toBeLessThan(
      2048,
    );
    await alepha.stop();
  });
});

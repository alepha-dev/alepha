import { $hook, $inject, Alepha } from "alepha";
import { McpServerProvider } from "alepha/mcp";

/**
 * Who Lore says it is to an MCP client, and how an agent should use it.
 *
 * Without this Lore introduced itself as the framework default,
 * `alepha-mcp` `1.0.0` (#Q3052). The version is the release version `/version`
 * reports, and `websiteUrl` the instance's own `PUBLIC_URL` (absent on an
 * instance that has none).
 *
 * The instructions stay short on purpose: a client may inject them into every
 * conversation.
 */
export class LoreMcpIdentity {
  protected readonly alepha = $inject(Alepha);
  protected readonly mcpServer = $inject(McpServerProvider);

  public readonly instructions = [
    "Lore is a project memory: quests record work, folios record decisions, epics group quests into a plan.",
    "Start with project_context for the project you work on: it lists areas, open quests and the pinned folios, which hold the project's conventions.",
    "Read a quest with quest_get, discussion included, before writing back to it: someone may have answered since.",
    "Accept a quest before working on it, tick objectives as they are met, and complete it with a short note of what shipped.",
    "Write a folio when you take a decision a later session would look for.",
  ].join(" ");

  public readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      const publicUrl = String(this.alepha.env.PUBLIC_URL ?? "").replace(
        /\/+$/,
        "",
      );
      this.mcpServer.serverInfo = {
        name: "lore",
        title: "Lore",
        version: this.alepha.meta.version,
        ...(publicUrl ? { websiteUrl: publicUrl } : {}),
      };
      this.mcpServer.instructions = this.instructions;
    },
  });
}

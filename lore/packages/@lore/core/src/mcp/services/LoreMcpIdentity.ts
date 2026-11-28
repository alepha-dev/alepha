import { $hook, $inject, Alepha } from "alepha";
import { McpServerProvider } from "alepha/mcp";

/**
 * Who Lore says it is to an MCP client, and how an agent should use it.
 *
 * Without this Lore introduced itself as the framework default,
 * `alepha-mcp` `1.0.0` (#Q3052). The version is the release version `/version`
 * reports, and `websiteUrl` the instance's own `PUBLIC_URL`, with the logo
 * as `icons` (both absent on an instance that has none).
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
    "Work you find in passing and do not take now is filed as a draft (quest_create with draft: true): its owner marks it ready.",
    "Write a folio when you take a decision a later session would look for.",
    "A list you will add to or change row by row is a table folio (folio_create with type table, then folio_row_add); prose stays a text folio.",
  ].join(" ");

  /**
   * The logo a client draws beside Lore's name in its connector list
   * (SEP-973, #Q3662). `theme` names the client theme an icon is FOR:
   * `logo-512x512.png` is drawn in white, so it is the dark theme's, and
   * `logo-512x512-light.png`, drawn in black, the light theme's. Absolute
   * URLs only, which is why there are none without `PUBLIC_URL`: a relative
   * path does not resolve on the client.
   */
  protected icons(
    publicUrl: string,
  ): NonNullable<McpServerProvider["serverInfo"]["icons"]> {
    return [
      {
        src: `${publicUrl}/logo-512x512-light.png`,
        mimeType: "image/png",
        sizes: ["512x512"],
        theme: "light",
      },
      {
        src: `${publicUrl}/logo-512x512.png`,
        mimeType: "image/png",
        sizes: ["512x512"],
        theme: "dark",
      },
    ];
  }

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
        ...(publicUrl
          ? { websiteUrl: publicUrl, icons: this.icons(publicUrl) }
          : {}),
      };
      this.mcpServer.instructions = this.instructions;
    },
  });
}

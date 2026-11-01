import { $hook, $inject, Alepha } from "alepha";
import type { ServerRequest } from "alepha/server";

export type ActivityChannelValue =
  | "web"
  | "mcp"
  | "cli"
  | "api"
  | "automation"
  | "system";

/**
 * How a write reached Lore (#Q3011), for `project_activity`.
 *
 * Over MCP the session user is the API key's owner, so `actor` cannot tell an
 * agent's work from its owner's. This can, and like a comment's `source` it
 * records how a write was made, not who made it.
 *
 * Read from the request on arrival and kept in the request's context, so an
 * audit written anywhere under it finds it. No request means a job: `system`.
 *
 * ## What a request can and cannot tell
 *
 * - `mcp`: the MCP endpoint's path.
 * - `cli` is a guess from the user agent: `@alepha/lore` runs on Node or Bun and
 *   sends their default. A script holding an API key on Node reads as `cli`
 *   too, and a CLI behind a custom fetch reads as `api`.
 * - `api`: an `ak_` key from anything else, or any other non-browser client.
 * - `web`: everything a browser sends.
 *
 * ⚠️ `automation` is not read from a request: an automation's write comes
 * through its native audit path, which names it.
 *
 * ⚠️ Nothing injects this class but `LoreAuditService`, which is what
 * constructs it, so the hook is live wherever audits are.
 */
export class ActivityChannel {
  protected readonly alepha = $inject(Alepha);

  static readonly KEY = "lore.activity.channel";

  protected readonly onRequest = $hook({
    on: "server:request:before",
    priority: "first",
    handler: ({ request }) => {
      this.alepha.context.set(ActivityChannel.KEY, this.classify(request));
    },
  });

  /**
   * The channel of the write in progress.
   */
  current(): ActivityChannelValue {
    return (
      this.alepha.context.get<ActivityChannelValue>(ActivityChannel.KEY) ??
      "system"
    );
  }

  classify(
    request: Pick<ServerRequest, "headers"> & { url: { pathname: string } },
  ): ActivityChannelValue {
    if (request.url.pathname.startsWith("/mcp")) {
      return "mcp";
    }
    const agent = String(request.headers["user-agent"] ?? "");
    if (/mozilla/i.test(agent)) {
      return "web";
    }
    if (/^(node|bun)\b/i.test(agent)) {
      return "cli";
    }
    return "api";
  }
}

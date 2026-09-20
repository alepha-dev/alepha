import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";

import { LoreAnalytics } from "../entities/loreAnalytics.ts";

/**
 * One point in `mcp_calls` per MCP tool call (#E65).
 *
 * ## The one question in this app with no data behind it
 *
 * MCP is Lore's primary consumer and a tool call leaves **no row in any
 * entity table**. A write eventually surfaces in the audit log -
 * `quest_update` becomes `quest:update` - but a read does not, and reads are
 * most of the traffic: `quest_get`, `project_context`, `folio_get`,
 * `quest_list` pass through and vanish. So "which tools do agents actually
 * call" was unanswerable, in every surface, by construction. This is where it
 * stops being.
 *
 * ## A hook, not a subclass
 *
 * The first version of this substituted `McpServerProvider` and overrode
 * `handleToolsCall`, the way `LoreAuditService` overrides `AuditService.create`.
 * It worked and it was wrong: a substitution has to be recorded before
 * anything resolves what it replaces, and `AlephaMcp` is wired by a `$tool`
 * auto-wire, by `LoreMcp`, and explicitly by several specs - so whether it
 * took effect depended on the order the container happened to be assembled
 * in, and `mcp-security.spec.ts` threw `TooLateSubstitutionError` as soon as
 * it existed. `mcp:tool:end` is the framework seam that replaced it: emitted
 * once per call on every path out of `handleToolsCall`, with no ordering
 * requirement at all.
 *
 * ⚠️ Nothing injects this class, so it is listed in `LoreMcp`'s `services`.
 * A `$hook` reaches a subscriber only if the subscriber was constructed.
 *
 * ## ⚠️ Best effort, and quick
 *
 * The emit is awaited inside the tool call, in front of the agent's answer.
 * A throw here would turn a successful `quest_get` into an error for the
 * agent that asked, so a failed record is logged and dropped. On production
 * this is one `writeDataPoint` into Analytics Engine, not a D1 round trip.
 */
export class McpCallRates {
  protected readonly log = $logger();
  protected readonly datasets = $inject(LoreAnalytics);

  public readonly onToolEnd = $hook({
    on: "mcp:tool:end",
    handler: async ({ name, outcome, context }) => {
      try {
        await this.datasets.mcpCalls.record({
          tool: name,
          outcome,
          // The transport's `buildContext` puts the authenticated user here.
          actor: (context?.data as { id?: string } | undefined)?.id ?? "anon",
          count: 1,
        });
      } catch (error) {
        this.log.warn("MCP call rate point not recorded", {
          tool: name,
          outcome,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

/**
 * What one request has spent, counted from `server:onRequest`.
 */
export interface McpCallTally {
  startedAt: number;
  reads: number;
  writes: number;
}

/**
 * One log line per MCP tool call: the tool, its outcome, the wall time since
 * the request arrived, and how many database statements it ran (#Q2634).
 *
 * ## Why it exists
 *
 * A tool call on the Worker spends 5 to 15 times its CPU waiting on D1
 * (#F1362), and the cause is how many queries it makes one after another.
 * Nothing in production said which tool made how many: Server-Timing is off,
 * `mcp:tool:end` carries no duration, and `wrangler tail` gives one
 * `wallTime` per HTTP request with nothing about the queries inside it. Every
 * quest of #E76 is judged on this line, before and after.
 *
 * ## How it counts
 *
 * A tally is seeded on `server:onRequest`, on the request layer of the ALS
 * context, for the reason `ResourceGateMemoProvider` gives: `$action.run()`
 * forks a layer per action, and a value created lazily inside one would be
 * invisible to the next. Every nested action then finds the same object and
 * mutates it by reference. One HTTP request is one tool call: JSON-RPC
 * batching left the MCP spec in 2025-06.
 *
 * The ORM's `repository:*:before` events fire after its cache check (the
 * reason `ReadCounter` counts reads with them), so a read served from the
 * 30 s project or rank cache is not counted. A raw `repository.query()` emits
 * nothing and is missed: the count is a floor.
 *
 * ## ⚠️ What `wallMs` means on a Worker
 *
 * workerd only advances the clock across I/O, so a stretch of pure CPU reads
 * as zero. `wallMs` is therefore the time spent waiting, on D1 and anything
 * else, which is exactly the half #E76 is about. CPU per request is
 * `wrangler tail`'s `cpuTime`.
 *
 * ## Best effort
 *
 * Like `McpCallRates`, the `mcp:tool:end` handler is awaited in front of the
 * agent's answer, so it does no I/O and cannot throw.
 */
export class McpCallTimings {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  /**
   * ALS key the per-request tally lives under.
   */
  static readonly KEY = "lore.mcp.callTally";

  protected readonly onServerRequest = $hook({
    on: "server:onRequest",
    priority: "first",
    handler: () => {
      this.alepha.context.set(McpCallTimings.KEY, {
        startedAt: this.dateTime.nowMillis(),
        reads: 0,
        writes: 0,
      } satisfies McpCallTally);
    },
  });

  protected readonly onRead = $hook({
    on: "repository:read:before",
    handler: () => {
      const tally = this.tally();
      if (tally) tally.reads += 1;
    },
  });

  protected readonly onCreate = $hook({
    on: "repository:create:before",
    handler: () => this.countWrite(),
  });

  protected readonly onUpdate = $hook({
    on: "repository:update:before",
    handler: () => this.countWrite(),
  });

  protected readonly onDelete = $hook({
    on: "repository:delete:before",
    handler: () => this.countWrite(),
  });

  protected readonly onToolEnd = $hook({
    on: "mcp:tool:end",
    handler: ({ name, outcome }) => {
      const tally = this.tally();
      if (!tally) return;
      this.log.info("MCP tool call", {
        tool: name,
        outcome,
        wallMs: this.dateTime.nowMillis() - tally.startedAt,
        reads: tally.reads,
        writes: tally.writes,
      });
    },
  });

  /**
   * The current request's tally, or `undefined` outside a request (a job, a
   * CLI command, a spec calling a tool directly).
   */
  public tally(): McpCallTally | undefined {
    return this.alepha.context.get<McpCallTally>(McpCallTimings.KEY);
  }

  protected countWrite(): void {
    const tally = this.tally();
    if (tally) tally.writes += 1;
  }
}

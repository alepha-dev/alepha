import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $tool, AlephaMcp, McpServerProvider } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AdminMcpController } from "../src/api/controllers/AdminMcpController.ts";
import { LoreAnalytics } from "../src/api/entities/loreAnalytics.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";

/**
 * The chart that could not be drawn before this epic (#E65, #Q2443).
 *
 * An MCP tool call leaves no row in any entity table - a write eventually
 * surfaces in the audit log, a read never does - so "which tools do agents
 * call, and which of them refuse" had no answer in this app at all until
 * `mcp_calls` existed. Two halves here: the call is recorded on the way
 * past, and the admin read turns the dataset into the timeline and the
 * leaderboard the page draws.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

/**
 * A tool that is simply broken: it throws something that is neither an
 * `McpError` nor an `HttpError` with a status.
 *
 * Registered only in this spec, because no Lore tool can be made to fail that
 * way on demand - and the `error` bucket is the whole reason the dataset
 * keeps two failure kinds apart, so leaving it unproven would leave the
 * chart's central claim unproven.
 */
class BrokenTool {
  broken = $tool({
    name: "broken_tool",
    description: "Always throws",
    schema: { params: z.object({}), result: z.string() },
    handler: async () => {
      throw new Error("the tool is broken");
    },
  });
}

interface TestContext {
  alepha: Alepha;
  mcp: McpServerProvider;
  admin: AdminMcpController;
  datasets: LoreAnalytics;
  user: { id: string; roles: string[] };
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);
  alepha.with(BrokenTool);
  await alepha.start();

  const admins = alepha.inject(AdminUserController);
  const fake = alepha.inject(FakeProvider);
  const created = await admins.createUser.fetch(
    {
      body: {
        ...fake.generate(z.object({ username: z.string(), email: z.email() })),
        roles: ["user"],
      },
    },
    { user: adminUser },
  );

  return {
    alepha,
    mcp: alepha.inject(McpServerProvider),
    admin: alepha.inject(AdminMcpController),
    datasets: alepha.inject(LoreAnalytics),
    user: { id: created.data.id, roles: created.data.roles },
  };
};

/**
 * A `tools/call`, the way a client sends one.
 */
const call = async (
  ctx: TestContext,
  name: unknown,
  args: Record<string, unknown> = {},
): Promise<void> => {
  await ctx.mcp
    .handleMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      } as never,
      { data: ctx.user },
    )
    // A tool that refuses answers with a JSON-RPC error rather than throwing
    // out of here, and one that throws is recorded on the way past: either
    // way the point is written, which is what these cases assert.
    .catch(() => undefined);
};

/**
 * Every point the dataset holds, by tool and outcome.
 */
const readCalls = async (ctx: TestContext) => {
  const result = await ctx.datasets.mcpCalls.query({
    since: "2000-01-01",
    groupBy: ["tool", "outcome", "actor"],
    select: { count: "sum" },
  });
  return result.rows.map((row) => ({
    tool: String(row.tool),
    outcome: String(row.outcome),
    actor: String(row.actor),
    count: Number(row.count),
  }));
};

describe("MCP call rates", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("recording", () => {
    it("records a point per call, carrying the tool and the caller", async ({
      expect,
    }) => {
      await call(ctx, "project_list", {});
      await call(ctx, "project_list", {});

      const points = await readCalls(ctx);
      const listed = points.find((point) => point.tool === "project_list");
      expect(listed?.count).toBe(2);
      expect(listed?.actor).toBe(ctx.user.id);
    });

    it("keeps a refusal apart from an error", async ({ expect }) => {
      // A tool that is not registered: `McpToolNotFoundError`, which is an
      // `McpError` - the caller asked for something that does not exist and
      // no retry fixes it.
      await call(ctx, "not_a_tool", {});
      // A real tool called with arguments it cannot accept: a validation
      // failure the model is expected to correct, which the spec returns as
      // `isError: true` rather than as a protocol error.
      await call(ctx, "quest_get", { shortId: "not-a-number" });

      const points = await readCalls(ctx);
      // ⚠️ Neither is an `error`: both are the API working. A single failure
      // bucket would make a misleading description indistinguishable from a
      // broken tool, which is the split the dataset exists to keep.
      expect(points.every((point) => point.outcome !== "error")).toBe(true);
      expect(points.find((point) => point.tool === "not_a_tool")?.outcome).toBe(
        "refused",
      );
    });

    it("records a tool that is simply broken as an error", async ({
      expect,
    }) => {
      await call(ctx, "broken_tool", {});

      const points = await readCalls(ctx);
      // ⚠️ This is the bucket the outcome split exists for. A tool called
      // constantly that REFUSES half its calls has a description that
      // misleads the model; a tool that ERRORS is broken. One failure count
      // would say neither.
      expect(
        points.find((point) => point.tool === "broken_tool")?.outcome,
      ).toBe("error");
    });

    // ⚠️ A `tools/call` whose `name` is missing or not a string is rejected by
    // the framework's own param validation, before a tool is ever looked up,
    // so it is never counted. That is the boundary of this seam and not a
    // gap: at that point there is no name to attribute the call to.
  });

  describe("the admin read", () => {
    it("answers a timeline and a leaderboard over the same window", async ({
      expect,
    }) => {
      await call(ctx, "project_list", {});
      await call(ctx, "project_list", {});
      await call(ctx, "not_a_tool", {});

      const page = await ctx.admin.readMcpCalls.fetch({}, {
        user: adminUser,
      } as never);

      expect(page.data.days).toHaveLength(30);

      const listed = page.data.leaderboard.find(
        (row) => row.tool === "project_list",
      );
      expect(listed?.total).toBe(2);
      expect(listed?.errors).toBe(0);

      const refused = page.data.leaderboard.find(
        (row) => row.tool === "not_a_tool",
      );
      expect(refused?.refused).toBe(1);

      // The busiest tool leads, and its series is zero-filled to the window
      // with today's calls on the newest label.
      const series = page.data.tools.find((row) => row.tool === "project_list");
      expect(series?.counts).toHaveLength(30);
      expect(series?.counts.at(-1)).toBe(2);
      expect(series?.total).toBe(2);
    });

    it("answers an empty window rather than nothing", async ({ expect }) => {
      const page = await ctx.admin.readMcpCalls.fetch({}, {
        user: adminUser,
      } as never);

      expect(page.data.days).toHaveLength(30);
      expect(page.data.tools).toEqual([]);
      expect(page.data.leaderboard).toEqual([]);
    });
  });
});

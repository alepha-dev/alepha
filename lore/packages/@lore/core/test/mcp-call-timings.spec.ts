import { AppSecurityProvider } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";
import { LoreCoreMcp } from "../src/mcp/index.ts";

/**
 * The per-call line #E76 is measured with (#Q2634): every MCP tool call logs
 * its tool, outcome, wall time and how many statements it ran.
 *
 * Driven over real HTTP, never through `McpServerProvider.handleMessage`:
 * the tally is seeded by `server:onRequest`, so a call that skips the server
 * would log nothing, and the spec would prove the harness instead of the
 * line production writes.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

interface TestContext {
  alepha: Alepha;
  baseUrl: string;
  logs: MemoryDestinationProvider;
  token: string;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "info", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  }).with({
    provide: LogDestinationProvider,
    use: MemoryDestinationProvider,
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreCoreApi);
  alepha.with(LoreCoreMcp);
  await alepha.start();

  const fake = alepha.inject(FakeProvider);
  const created = await alepha.inject(AdminUserController).createUser.fetch(
    {
      body: {
        ...fake.generate(z.object({ username: z.string(), email: z.email() })),
        roles: ["user"],
      },
    },
    { user: adminUser },
  );
  const tokens = await alepha
    .inject(AppSecurityProvider)
    .realm.createToken({ id: created.data.id, roles: created.data.roles });

  return {
    alepha,
    baseUrl: alepha.inject(NodeHttpServerProvider).hostname,
    logs: alepha.inject(MemoryDestinationProvider),
    token: tokens.access_token,
  };
};

/**
 * A `tools/call` over HTTP, and the timing line it logged.
 */
const callAndRead = async (
  ctx: TestContext,
  name: string,
  args: Record<string, unknown> = {},
) => {
  const before = ctx.logs.logs.length;
  const response = await fetch(`${ctx.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ctx.token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  await response.text();
  return ctx.logs.logs
    .slice(before)
    .filter((entry) => entry.message === "MCP tool call")
    .map((entry) => entry.data);
};

describe("MCP call timings", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("logs one line per tool call with its wall time and the statements it ran", async ({
    expect,
  }) => {
    const lines = await callAndRead(ctx, "project_list");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      tool: "project_list",
      outcome: "ok",
      writes: 0,
    });
    // `project_list` reads the caller with their projects at least: a zero
    // here means the tally was not seeded on the request layer, and every
    // nested action counted into a fork nobody reads.
    expect(lines[0].reads).toBeGreaterThan(0);
    expect(lines[0].wallMs).toBeGreaterThanOrEqual(0);
  });

  it("logs a refused call to a tool that does not exist, with nothing read", async ({
    expect,
  }) => {
    const lines = await callAndRead(ctx, "no_such_tool");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      tool: "no_such_tool",
      outcome: "refused",
      reads: 0,
      writes: 0,
    });
  });
});

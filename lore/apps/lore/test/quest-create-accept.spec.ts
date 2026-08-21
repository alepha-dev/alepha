import { Alepha, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";

// `accept: true` on quest_create is the MCP equivalent of the UI's
// "Create and accept" split button: create the quest, then immediately
// accept (assign to the caller) in the same tool call — no quest_accept
// round-trip. The accept half is best-effort: if it can't land (e.g. the
// new quest is gated behind an incomplete predecessor), the quest is still
// created and the tool reports why it stayed unaccepted instead of erroring.

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

interface TestContext {
  alepha: Alepha;
  baseUrl: string;
  adminUserController: AdminUserController;
  apiKeyController: ApiKeyController;
  projectController: ProjectController;
  fakeProvider: FakeProvider;
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

  await alepha.start();

  const server = alepha.inject(NodeHttpServerProvider);

  return {
    alepha,
    baseUrl: server.hostname,
    adminUserController: alepha.inject(AdminUserController),
    apiKeyController: alepha.inject(ApiKeyController),
    projectController: alepha.inject(ProjectController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

interface McpToolResult {
  jsonrpc: string;
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

const mcpCall = async (
  baseUrl: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> => {
  const response = await fetch(`${baseUrl}/mcp?api_key=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return (await response.json()) as McpToolResult;
};

const isError = (data: McpToolResult): boolean =>
  data.error !== undefined || data.result?.isError === true;

const payload = <T>(data: McpToolResult): T => {
  const text = data.result?.content?.[0]?.text;
  if (!text)
    throw new Error(`Tool returned no content: ${JSON.stringify(data)}`);
  return JSON.parse(text) as T;
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createApiKey = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<string> => {
  const response = await ctx.apiKeyController.createApiKey.fetch(
    { body: { name: "Test Key" } },
    { user },
  );
  return response.data.token;
};

interface QuestCreateResult {
  id: number;
  shortId: number;
  title: string;
  createdAt: string;
  acceptedAt?: string;
  acceptNote?: string;
}

interface QuestGetResult {
  id: number;
  status: "new" | "accepted" | "completed";
}

describe("quest_create — accept flag", () => {
  let ctx: TestContext;
  let token: string;
  let projectId: number;

  beforeEach(async () => {
    ctx = await setup();
    const owner = await createTestUser(ctx);
    token = await createApiKey(ctx, owner);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Accept Probe" } },
      { user: owner },
    );
    projectId = project.data.id;
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates and accepts the quest in one call when accept is true", async ({
    expect,
  }) => {
    const res = await mcpCall(ctx.baseUrl, token, "quest_create", {
      project: projectId,
      title: "Wire the thing",
      description: "do it",
      area: "core",
      priority: "medium",
      accept: true,
    });

    expect(isError(res)).toBe(false);
    const quest = payload<QuestCreateResult>(res);
    expect(quest.acceptedAt).toBeTruthy();
    expect(quest.acceptNote).toBeUndefined();

    // The quest is genuinely in the accepted lane, not just stamped.
    const got = await mcpCall(ctx.baseUrl, token, "quest_get", {
      id: quest.id,
    });
    expect(payload<QuestGetResult>(got).status).toBe("accepted");
  });

  it("leaves the quest unaccepted when accept is omitted", async ({
    expect,
  }) => {
    const res = await mcpCall(ctx.baseUrl, token, "quest_create", {
      project: projectId,
      title: "Backlog item",
      description: "later",
      area: "core",
      priority: "low",
    });

    expect(isError(res)).toBe(false);
    const quest = payload<QuestCreateResult>(res);
    expect(quest.acceptedAt).toBeUndefined();

    const got = await mcpCall(ctx.baseUrl, token, "quest_get", {
      id: quest.id,
    });
    expect(payload<QuestGetResult>(got).status).toBe("new");
  });

  it("still creates the quest but skips accept when blocked by an incomplete predecessor", async ({
    expect,
  }) => {
    // Predecessor stays "new" (never accepted/completed).
    const predecessor = await mcpCall(ctx.baseUrl, token, "quest_create", {
      project: projectId,
      title: "Setup first",
      description: "must finish before the follow-up",
      area: "core",
      priority: "medium",
    });
    const predShortId = payload<QuestCreateResult>(predecessor).shortId;

    const res = await mcpCall(ctx.baseUrl, token, "quest_create", {
      project: projectId,
      title: "Follow-up",
      description: "depends on setup",
      area: "core",
      priority: "medium",
      dependsOn_shortId: predShortId,
      accept: true,
    });

    // The tool call succeeds (no error) — the quest was created.
    expect(isError(res)).toBe(false);
    const quest = payload<QuestCreateResult>(res);
    expect(quest.id).toBeGreaterThan(0);
    // ...but the accept half was refused and reported, not thrown.
    expect(quest.acceptedAt).toBeUndefined();
    expect(quest.acceptNote).toContain(`#${predShortId}`);

    const got = await mcpCall(ctx.baseUrl, token, "quest_get", {
      id: quest.id,
    });
    expect(payload<QuestGetResult>(got).status).toBe("new");
  });
});

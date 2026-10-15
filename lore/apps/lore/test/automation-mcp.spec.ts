import { AutomationPersistence, AutomationService } from "@lore/core/api";
import type { AutomationResource, AutomationRule } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { ReleaseController } from "@lore/work/api";
import { Alepha, AlephaError } from "alepha";
import { ApiKeyService } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { CronProvider } from "alepha/scheduler";
import { NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestFolio,
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

interface McpReply {
  result?: {
    structuredContent?: Record<string, any>;
    isError?: boolean;
    content?: Array<{ text?: string }>;
    tools?: Array<{ name: string }>;
  };
  error?: { message: string };
}

describe("Automation MCP transport uses shared application policy", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let persistence: AutomationPersistence;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: { id: string; roles: string[] };
  let token: string;
  let url: string;
  const request = async (
    method: string,
    params: Record<string, unknown>,
    credential = token,
  ): Promise<McpReply> => {
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return response.json();
  };
  const call = (
    name: string,
    args: Record<string, unknown> = {},
    credential = token,
  ) =>
    request(
      "tools/call",
      { name, arguments: { project: project.id, ...args } },
      credential,
    );
  const value = (reply: McpReply) => {
    if (reply.error || reply.result?.isError)
      throw new AlephaError(
        reply.error?.message ??
          reply.result?.content?.[0]?.text ??
          "MCP tool refused",
      );
    return reply.result?.structuredContent ?? {};
  };
  const failed = (reply: McpReply) =>
    reply.error?.message ??
    (reply.result?.isError ? reply.result.content?.[0]?.text : undefined);
  const rule = (): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "quest.completed" },
    select: null,
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Quest",
        text: "{{title}}",
        category: "automations",
      },
    ],
  });
  const create = async (ast = rule(), extra: Record<string, unknown> = {}) =>
    value(
      await call("automation_create", {
        title: "MCP rule",
        rule: ast,
        ...extra,
      }),
    ) as AutomationResource;
  const key = async (userId = user.id, permissions?: string[]) =>
    (
      await alepha.inject(ApiKeyService).create({
        userId,
        name: `Automation MCP ${crypto.randomUUID()}`,
        roles: ["user"],
        ...(permissions ? { permissions } : {}),
      })
    ).token;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    }).with({ provide: CronProvider, use: ManualCronProvider });
    bootLore(alepha, ["api", "mcp"]);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    await alepha.start();
    alepha.inject(DateTimeProvider).pause();
    url = alepha.inject(NodeHttpServerProvider).hostname;
    project = await createTestProject(alepha, {
      title: "MCP Automations",
      capabilities: [
        { key: "work", options: { automations: true, releases: true } },
        { key: "knowledge" },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
    token = await key();
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("discovers, creates, previews and enables a release append and notification using typed bindings", async ({
    expect,
  }) => {
    const tools = await request("tools/list", {});
    expect(tools.result?.tools?.map((it) => it.name)).toContain(
      "automation_create",
    );
    const catalogue = value(
      await call("automation_catalog", {
        project: undefined,
        project_name: "mcp-automations",
      }),
    );
    expect(catalogue.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "release.published", available: true }),
        expect.objectContaining({ key: "appendFolio", available: true }),
      ]),
    );
    const folio = await createTestFolio(alepha, project);
    const recipient = value(
      await call("automation_variable_set", {
        key: "recipient",
        variable: { value: { kind: "member", value: user.id } },
      }),
    );
    expect(recipient.variable.value).toEqual({
      kind: "member",
      value: user.id,
    });
    const ast: AutomationRule = {
      version: 1,
      trigger: { kind: "event", event: "release.published" },
      select: null,
      guard: null,
      actions: [
        {
          kind: "appendFolio",
          folio: folio.id,
          text: "## {{release_tag}}\n{{changelog}}",
        },
        {
          kind: "notify",
          recipient: "{{recipient}}",
          channel: "inbox",
          title: "Release {{release_tag}}",
          text: "{{title}}: {{url}}",
          category: "releases",
        },
      ],
    };
    const made = await create(ast);
    expect(made).toMatchObject({
      enabled: false,
      authorUserId: user.id,
      revision: 0,
      rule: ast,
    });
    expect(made).not.toHaveProperty("authorKeyId");
    const release = (
      await alepha.inject(ReleaseController).createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag: "1.2.3", title: "MCP publication" },
        },
        { user },
      )
    ).data;
    const before = JSON.stringify(await persistence.rules.findMany());
    const preview = value(
      await call("automation_test", {
        id: made.id,
        source: { kind: "subject", id: release.id },
      }),
    );
    expect(preview).toMatchObject({
      preview: true,
      status: "preview",
      operations: [
        expect.objectContaining({ index: 0 }),
        expect.objectContaining({ index: 1 }),
      ],
    });
    expect(JSON.stringify(await persistence.rules.findMany())).toBe(before);
    expect(await persistence.runs.findMany()).toHaveLength(0);
    const armed = value(
      await call("automation_update", {
        id: made.id,
        expectedRevision: 0,
        enabled: true,
      }),
    );
    expect(armed).toMatchObject({ enabled: true, revision: 1 });
    expect(value(await call("automation_get", { id: made.id }))).toMatchObject({
      enabled: true,
      rule: ast,
    });
    const page = value(
      await call("automation_list", { limit: 1, search: "MCP" }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(made.id);
    expect((await persistence.rules.getById(made.id)).authorKeyId).toBeTruthy();
  });

  it("fences revisions, refuses spoofed identity and restricts managers to stopping foreign rules", async ({
    expect,
  }) => {
    const made = await create();
    expect(
      failed(
        await call("automation_create", {
          title: "Spoofed",
          rule: rule(),
          authorUserId: user.id,
        }),
      ),
    ).toBeTruthy();
    const changed = value(
      await call("automation_update", {
        id: made.id,
        expectedRevision: 0,
        title: "Changed",
        rule: rule(),
      }),
    );
    expect(changed.revision).toBe(1);
    expect(
      failed(
        await call("automation_update", {
          id: made.id,
          expectedRevision: 0,
          enabled: true,
        }),
      ),
    ).toMatch(/revision|changed/i);
    const member = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, member.id, { rank: "admin" });
    const manager = await key(member.id);
    expect(
      failed(
        await call(
          "automation_update",
          { id: made.id, expectedRevision: 1, title: "Foreign", rule: rule() },
          manager,
        ),
      ),
    ).toBeTruthy();
    expect(
      failed(
        await call(
          "automation_update",
          { id: made.id, expectedRevision: 1, enabled: true },
          manager,
        ),
      ),
    ).toBeTruthy();
    const armed = value(
      await call("automation_update", {
        id: made.id,
        expectedRevision: 1,
        enabled: true,
      }),
    );
    const stopped = value(
      await call(
        "automation_update",
        { id: made.id, expectedRevision: armed.revision, enabled: false },
        manager,
      ),
    );
    expect(stopped.enabled).toBe(false);
    expect(
      value(
        await call(
          "automation_delete",
          { id: made.id, expectedRevision: stopped.revision },
          manager,
        ),
      ),
    ).toEqual({ ok: true });
  });

  it("reports variable consumers and requires matching identity and version for changes and unused deletion", async ({
    expect,
  }) => {
    const variable = value(
      await call("automation_variable_set", {
        key: "recipient",
        variable: { value: { kind: "member", value: user.id } },
      }),
    ).variable;
    const ast = rule();
    if (ast.actions[0].kind === "notify")
      ast.actions[0].recipient = "{{recipient}}";
    const made = await create(ast);
    const usage = value(
      await call("automation_variable_dependents", {
        key: "recipient",
        limit: 1,
      }),
    );
    expect(usage.items[0].id).toBe(made.id);
    expect(
      failed(
        await call("automation_variable_set", {
          key: "recipient",
          variable: { value: variable.value },
        }),
      ),
    ).toMatch(/identity|version/i);
    expect(
      failed(
        await call("automation_variable_delete", {
          key: "recipient",
          id: variable.id,
          version: variable.version,
        }),
      ),
    ).toMatch(/used|referenc|consumer/i);
    expect(
      value(await call("automation_variable_list", { limit: 1 })).items[0],
    ).toMatchObject(variable);
    value(
      await call("automation_delete", { id: made.id, expectedRevision: 0 }),
    );
    expect(
      value(
        await call("automation_variable_delete", {
          key: "recipient",
          id: variable.id,
          version: variable.version,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects invalid slots, foreign targets and scoped keys without the source grant", async ({
    expect,
  }) => {
    const invalid = rule();
    invalid.trigger = { kind: "schedule", cron: "0 0 * * *" };
    invalid.select = {
      kind: "rows",
      key: "unknown",
      filters: {},
    } as AutomationRule["select"];
    expect(
      failed(
        await call("automation_create", { title: "Invalid", rule: invalid }),
      ),
    ).toMatch(/select|unknown|key/i);
    const foreignProject = await createTestProject(alepha);
    const foreign = await createTestFolio(alepha, foreignProject);
    const ast = rule();
    ast.actions = [{ kind: "appendFolio", folio: foreign.id, text: "No" }];
    expect(
      failed(await call("automation_create", { title: "Foreign", rule: ast })),
    ).toMatch(/folio|project|found/i);
    const scoped = await key(user.id, [
      "project:read",
      "automation:read",
      "automation:write",
      "member:read",
    ]);
    expect(
      failed(
        await call(
          "automation_create",
          { title: "No source", rule: rule() },
          scoped,
        ),
      ),
    ).toMatch(/quest:read|permission|grant/i);
    const made = await create(rule(), { enabled: true });
    expect(made.enabled).toBe(true);
    await alepha
      .inject(AutomationService)
      .setEnabled(project.id, made.id, user, false, made.revision);
  });
});

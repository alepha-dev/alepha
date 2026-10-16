import {
  AutomationAccess,
  AutomationAuthority,
  AutomationRunEvidence,
  AppSecurityProvider,
  LoreOAuthScopes,
  AutomationConfigurationWrites,
  AutomationController,
  AutomationPersistence,
  AutomationService,
  AutomationVariableService,
  AutomationClaims,
  AutomationDatabase,
  AutomationEvents,
  AutomationWorker,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { audits } from "alepha/api/audits";
import { ApiKeyService, apiKeyEntity } from "alepha/api/keys";
import { oauthClientEntity, oauthOptions } from "alepha/api/oauth";
import { RankService } from "alepha/api/organizations";
import { parameters } from "alepha/api/parameters";
import { sessions } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, sql } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestFolio,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class ApiConfigurationRace extends AutomationConfigurationWrites {
  public before?: () => Promise<void>;
  public override async commit(
    ...args: Parameters<AutomationConfigurationWrites["commit"]>
  ) {
    if (this.before) {
      const task = this.before;
      this.before = undefined;
      await task();
    }
    return super.commit(...args);
  }
}
class CountingAccess extends AutomationAccess {
  public authorizations = 0;
  public override async authorize(
    ...args: Parameters<AutomationAccess["authorize"]>
  ) {
    this.authorizations += 1;
    return super.authorize(...args);
  }
}
class ApiRows {
  public readonly audits = $repository(audits);
  public readonly keys = $repository(apiKeyEntity);
  public readonly sessions = $repository(sessions);
  public readonly clients = $repository(oauthClientEntity);
  public readonly parameters = $repository(parameters);
}

describe("Shared automation application service and HTTP actions", () => {
  let alepha: Alepha;
  let api: AutomationController;
  let persistence: AutomationPersistence;
  let service: AutomationService;
  let variables: AutomationVariableService;
  let entities: TestEntityRepositories;
  let rows: ApiRows;
  let time: DateTimeProvider;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const ast = (): AutomationRule => ({
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
  const create = async (rule = ast(), actor = user) =>
    (
      await api.createAutomation.fetch(
        { params: { projectId: project.id }, body: { title: "Rule", rule } },
        { user: actor },
      )
    ).data;
  const manager = async () => {
    const account = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, account.id, { rank: "admin" });
    return { id: account.id, roles: ["user"] };
  };
  const grant = async () => {
    const client = await rows.clients.create({
      clientId: crypto.randomUUID(),
      clientName: "Automation test client",
      realm: "users",
      redirectUris: ["http://localhost/callback"],
      scopes: ["mcp"],
    });
    const session = await rows.sessions.create({
      userId: user.id,
      clientId: client.clientId,
      scopes: ["mcp"],
      refreshToken: crypto.randomUUID(),
      expiresAt: time.now().add(30, "days").toISOString(),
      lastUsedAt: time.nowISOString(),
    });
    const actor: UserAccountToken = {
      ...user,
      realm: "users",
      sessionId: session.id,
      credential: { type: "oauth", clientId: client.clientId },
      permissionScope: [
        "project:*",
        "automation:*",
        "quest:read",
        "member:read",
      ],
    };
    return { actor, client, session };
  };
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({
        provide: AutomationConfigurationWrites,
        use: ApiConfigurationRace,
      })
      .with({ provide: AutomationAccess, use: CountingAccess });
    bootLore(alepha);
    alepha.store.set(oauthOptions, {
      ...alepha.store.get(oauthOptions),
      scopes: LoreOAuthScopes.SCOPES,
    });
    api = alepha.inject(AutomationController);
    persistence = alepha.inject(AutomationPersistence);
    service = alepha.inject(AutomationService);
    variables = alepha.inject(AutomationVariableService);
    entities = alepha.inject(TestEntityRepositories);
    rows = alepha.inject(ApiRows);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true, releases: true } },
        { key: "knowledge" },
        { key: "support" },
        { key: "apps", options: { track: true } },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("serializes the full CRUD resource and audits every mutation without executable content", async ({
    expect,
  }) => {
    const rule = await create();
    expect(rule).toMatchObject({
      projectId: project.id,
      authorUserId: user.id,
      enabled: false,
      displayState: "disabled",
      health: "active",
      revision: 0,
      canEdit: true,
      canEnable: true,
      canDisable: true,
      canDelete: true,
      redacted: false,
      rule: ast(),
    });
    expect(rule).not.toHaveProperty("authorKeyId");
    expect(rule).not.toHaveProperty("authorSessionId");
    const updated = (
      await api.updateAutomation.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { title: "Changed", rule: ast(), expectedRevision: 0 },
        },
        { user },
      )
    ).data;
    expect(updated).toMatchObject({
      title: "Changed",
      revision: 1,
      enabled: false,
    });
    const enabled = (
      await api.setAutomationEnabled.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { enabled: true, expectedRevision: 1 },
        },
        { user },
      )
    ).data;
    expect(enabled).toMatchObject({
      enabled: true,
      revision: 2,
      displayState: "active",
    });
    const disabled = (
      await api.setAutomationEnabled.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { enabled: false, expectedRevision: 2 },
        },
        { user },
      )
    ).data;
    expect(disabled).toMatchObject({
      enabled: false,
      revision: 3,
      displayState: "disabled",
    });
    await api.deleteAutomation.fetch(
      {
        params: { projectId: project.id, id: rule.id },
        body: { expectedRevision: 3 },
      },
      { user },
    );
    const retained = await persistence.rules.getById(rule.id, { force: true });
    expect(retained.deletedAt).toBeDefined();
    const auditRows = await rows.audits.findMany({
      where: { type: "automation", scopeId: String(project.id) },
      orderBy: "id",
    });
    expect(auditRows.map((row) => row.action)).toEqual([
      "create",
      "update",
      "enable",
      "disable",
      "delete",
    ]);
    expect(
      auditRows.every(
        (row) => row.userId === user.id && row.resourceId === rule.id,
      ),
    ).toBe(true);
    expect(JSON.stringify(auditRows)).not.toContain("{{title}}");
  });
  it("refuses stale revisions, identity injection and foreign project addressing", async ({
    expect,
  }) => {
    const rule = await create();
    await api.updateAutomation.fetch(
      {
        params: { projectId: project.id, id: rule.id },
        body: { title: "First", rule: ast(), expectedRevision: 0 },
      },
      { user },
    );
    await expect(
      api.updateAutomation.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { title: "Overwrite", rule: ast(), expectedRevision: 0 },
        },
        { user },
      ),
    ).rejects.toThrow("revision changed");
    await expect(
      api.deleteAutomation.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { expectedRevision: 0 },
        },
        { user },
      ),
    ).rejects.toThrow("revision changed");
    await expect(
      api.createAutomation.fetch(
        {
          params: { projectId: project.id },
          body: {
            title: "Injected",
            rule: ast(),
            authorUserId: crypto.randomUUID(),
          } as never,
        },
        { user },
      ),
    ).rejects.toThrow();
    const other = await createTestProject(alepha, {
      capabilities: [{ key: "work", options: { automations: true } }],
    });
    await createTestMember(alepha, other, user.id, { rank: "owner" });
    await expect(
      api.getAutomation.fetch(
        { params: { projectId: other.id, id: rule.id } },
        { user },
      ),
    ).rejects.toThrow("not in this project");
    expect((await persistence.rules.getById(rule.id)).title).toBe("First");
  });
  it("lets a manager disable/delete foreign rules while refusing edits and re-enable", async ({
    expect,
  }) => {
    const rule = await create();
    await service.setEnabled(project.id, rule.id, user, true, 0);
    const actor = await manager();
    await expect(
      api.updateAutomation.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { title: "Take over", rule: ast(), expectedRevision: 1 },
        },
        { user: actor },
      ),
    ).rejects.toThrow("immutable author");
    await expect(
      api.setAutomationEnabled.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { enabled: true, expectedRevision: 1 },
        },
        { user: actor },
      ),
    ).rejects.toThrow("immutable author");
    const disabled = (
      await api.setAutomationEnabled.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { enabled: false, expectedRevision: 1 },
        },
        { user: actor },
      )
    ).data;
    expect(disabled).toMatchObject({
      authorUserId: user.id,
      enabled: false,
      revision: 2,
      canEdit: false,
      canEnable: false,
    });
    await api.deleteAutomation.fetch(
      {
        params: { projectId: project.id, id: rule.id },
        body: { expectedRevision: 2 },
      },
      { user: actor },
    );
    expect(
      await rows.audits.findOne({
        where: { type: "automation", action: "delete", resourceId: rule.id },
      }),
    ).toMatchObject({ userId: actor.id });
  });
  it("supports management-only disable without granting source reads", async ({
    expect,
  }) => {
    const rule = await create();
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "stopper",
        name: "Stopper",
        permissions: ["project:read", "automation:manage"],
      },
      user,
    );
    const account = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, account.id, { rank: "stopper" });
    const result = (
      await api.setAutomationEnabled.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { enabled: false, expectedRevision: 0 },
        },
        { user: { id: account.id, roles: ["user"] } },
      )
    ).data;
    expect(result).toMatchObject({
      redacted: true,
      rule: null,
      enabled: false,
      canDisable: true,
      canEdit: false,
    });
  });
  it("requires variable identity/version and preserves used values while reporting paused foreign consumers", async ({
    expect,
  }) => {
    const variable = (
      await api.setAutomationVariable.fetch(
        {
          params: { projectId: project.id, key: "message" },
          body: { value: { kind: "text", value: "Before" } },
        },
        { user },
      )
    ).data.variable;
    const rule = ast();
    rule.actions = [
      {
        ...rule.actions[0],
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Quest",
        text: "{{message}}",
        category: "automations",
      },
    ];
    const stored = await create(rule);
    await service.setEnabled(project.id, stored.id, user, true, 0);
    const actor = await manager();
    await expect(
      api.setAutomationVariable.fetch(
        {
          params: { projectId: project.id, key: "message" },
          body: { value: { kind: "text", value: "No identity" } },
        },
        { user: actor },
      ),
    ).rejects.toThrow("identity or version");
    const changed = (
      await api.setAutomationVariable.fetch(
        {
          params: { projectId: project.id, key: "message" },
          body: {
            id: variable.id,
            version: 0,
            value: { kind: "text", value: "After" },
          },
        },
        { user: actor },
      )
    ).data;
    expect(changed).toMatchObject({
      variable: { id: variable.id, version: 1 },
      affected: [{ id: stored.id, requiresApproval: true }],
      affectedCount: 1,
    });
    const paused = await persistence.rules.getById(stored.id);
    expect(paused).toMatchObject({
      enabled: true,
      health: "paused",
      requiresApproval: true,
    });
    await expect(
      api.deleteAutomationVariable.fetch(
        {
          params: { projectId: project.id, key: "message" },
          body: { id: variable.id, version: 1 },
        },
        { user },
      ),
    ).rejects.toThrow("referenced");
    await service.setEnabled(
      project.id,
      stored.id,
      user,
      true,
      paused.revision,
    );
    expect(
      (await persistence.rules.getById(stored.id)).approvedVariables,
    ).toEqual([{ id: variable.id, key: "message", version: 1 }]);
  });
  it("paginates lists and redacts variables, definitions and historical payloads by current source reads", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project, {
      title: "Private target",
      content: "Private body",
    });
    const variable = await variables.set(project.id, user, "target", {
      value: { kind: "folio", value: folio.id },
    });
    const rule = ast();
    rule.actions = [
      { kind: "appendFolio", folio: "{{target}}", text: "{{title}}" },
    ];
    const stored = await create(rule);
    await create();
    const page = (
      await api.listAutomations.fetch(
        { params: { projectId: project.id }, query: { limit: 1, offset: 0 } },
        { user },
      )
    ).data;
    expect(page).toMatchObject({
      items: expect.any(Array),
      hasMore: true,
      nextOffset: 1,
    });
    const reader = await entities.users.create({ roles: ["user"] });
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "reader",
        name: "Reader",
        permissions: ["project:read", "automation:read", "quest:read"],
      },
      user,
    );
    await createTestMember(alepha, project, reader.id, { rank: "reader" });
    const caller = { id: reader.id, roles: ["user"] };
    const definition = (
      await api.getAutomation.fetch(
        { params: { projectId: project.id, id: stored.id } },
        { user: caller },
      )
    ).data;
    expect(definition).toMatchObject({
      rule: null,
      redacted: true,
      authorUserId: user.id,
    });
    const values = (
      await api.listAutomationVariables.fetch(
        { params: { projectId: project.id }, query: {} },
        { user: caller },
      )
    ).data;
    expect(values.items[0]).toMatchObject({
      id: variable.variable.id,
      value: null,
      available: false,
    });
    const run = await alepha.inject(AutomationRunEvidence).start({
      rule: await persistence.rules.getById(stored.id),
      occurrenceId: crypto.randomUUID(),
      triggeredAt: time.nowISOString(),
      inputs: { title: "Private historic title" },
      variables: [
        {
          id: variable.variable.id,
          key: "target",
          version: 0,
          value: { kind: "folio", value: folio.id },
        },
      ],
      selected: [],
      matched: 0,
      planned: [],
    });
    const historical = (
      await api.getAutomationRun.fetch(
        {
          params: { projectId: project.id, id: run.id },
        },
        { user: caller },
      )
    ).data;
    expect(historical).toMatchObject({
      id: run.id,
      snapshot: null,
      redacted: true,
    });
    expect(JSON.stringify([definition, values, historical])).not.toContain(
      folio.id,
    );
    expect(JSON.stringify(historical)).not.toContain("Private historic title");
  });
  it("authorizes a page of rules or runs once and answers what per-row reads answered", async ({
    expect,
  }) => {
    const folio = await createTestFolio(alepha, project);
    await variables.set(project.id, user, "target", {
      value: { kind: "folio", value: folio.id },
    });
    const shared = ast();
    shared.actions = [
      { kind: "appendFolio", folio: "{{target}}", text: "{{title}}" },
    ];
    const made = [await create(shared), await create(shared), await create()];
    const evidence = alepha.inject(AutomationRunEvidence);
    for (let index = 0; index < 3; index++)
      await evidence.start({
        rule: await persistence.rules.getById(made[0].id),
        occurrenceId: crypto.randomUUID(),
        triggeredAt: time.nowISOString(),
        inputs: { title: `Run ${index}` },
        selected: [],
        matched: 0,
        planned: [],
      });
    const counter = alepha.inject(CountingAccess);
    counter.authorizations = 0;
    const page = await service.list(project.id, user, { limit: 10 });
    expect(counter.authorizations).toBe(1);
    expect(page.items).toHaveLength(3);
    counter.authorizations = 0;
    const runs = await service.runs(project.id, made[0].id, user, {
      limit: 10,
    });
    expect(counter.authorizations).toBe(1);
    expect(runs.items).toHaveLength(3);
    for (const item of page.items)
      expect(item).toEqual(await service.get(project.id, item.id, user));
    for (const item of runs.items)
      expect(item).toEqual(await service.run(project.id, item.id, user));
  });
  it("preserves scalar baselines for prose/cadence edits and resets changed predicates", async ({
    expect,
  }) => {
    const rule: AutomationRule = {
      version: 1,
      trigger: { kind: "schedule", cron: "*/5 * * * *" },
      select: { kind: "scalar", key: "openBlights", filters: {} },
      guard: { field: "value", operator: "crossesAbove", value: 5 },
      actions: ast().actions,
    };
    const created = await create(rule);
    await persistence.rules.updateById(created.id, {
      baseline: { signature: "kept", value: 3 },
    });
    const prose = {
      ...rule,
      trigger: { kind: "schedule" as const, cron: "10 * * * *" },
      actions: [{ ...rule.actions[0], title: "Reworded" }],
    } as AutomationRule;
    await service.update(project.id, created.id, user, 0, {
      title: "Prose",
      rule: prose,
    });
    expect((await persistence.rules.getById(created.id)).baseline).toEqual({
      signature: "kept",
      value: 3,
    });
    await service.update(project.id, created.id, user, 1, {
      title: "Threshold",
      rule: { ...prose, guard: { ...rule.guard!, value: 6 } },
    });
    expect(
      (await persistence.rules.getById(created.id)).baseline,
    ).toBeUndefined();
    await service.update(project.id, created.id, user, 2, {
      title: "Back",
      rule,
    });
    expect(
      (await persistence.rules.getById(created.id)).baseline,
    ).toBeUndefined();
  });
  it("records exactly one health restoration with a repaired configuration and its audit", async ({
    expect,
  }) => {
    const created = await create();
    await alepha
      .inject(AutomationRunEvidence)
      .transition(created.id, "broken", "Target unavailable", false);
    const before = await persistence.runs.count({ automationId: created.id });
    await service.update(project.id, created.id, user, 0, {
      title: "Repaired",
      rule: ast(),
    });
    expect(await persistence.rules.getById(created.id)).toMatchObject({
      health: "active",
      revision: 1,
    });
    expect(await persistence.runs.count({ automationId: created.id })).toBe(
      before + 1,
    );
    await service.update(project.id, created.id, user, 1, {
      title: "No health change",
      rule: ast(),
    });
    expect(await persistence.runs.count({ automationId: created.id })).toBe(
      before + 1,
    );
  });
  it("uses one read-only HTTP test path for disabled rules with full response fields", async ({
    expect,
  }) => {
    const quest = await createTestQuest(alepha, project, {
      title: "Visible source",
    });
    const rule = await create();
    const before = JSON.stringify(
      await Promise.all([
        persistence.rules.findMany(),
        persistence.runs.findMany(),
        persistence.receipts.findMany(),
        rows.audits.findMany(),
      ]),
    );
    const report = (
      await api.testAutomation.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          body: { source: { kind: "subject", id: quest.id } },
        },
        { user },
      )
    ).data;
    expect(report).toMatchObject({
      preview: true,
      status: "preview",
      source: { mode: "prospective" },
      operations: [{ action: { text: "Visible source" } }],
      counts: { executed: 0 },
    });
    expect(
      JSON.stringify(
        await Promise.all([
          persistence.rules.findMany(),
          persistence.runs.findMany(),
          persistence.receipts.findMany(),
          rows.audits.findMany(),
        ]),
      ),
    ).toBe(before);
  });
  it("preserves an API key ceiling through actual HTTP authentication and current execution checks", async ({
    expect,
  }) => {
    const key = await alepha.inject(ApiKeyService).create({
      userId: user.id,
      name: "Automation scoped",
      roles: ["user"],
      permissions: [
        "project:read",
        "automation:read",
        "automation:write",
        "automation:manage",
        "quest:read",
        "member:read",
      ],
    });
    const headers = { authorization: `Bearer ${key.token}` };
    const made = (
      await api.createAutomation.fetch(
        {
          params: { projectId: project.id },
          body: { title: "Scoped", rule: ast() },
        },
        { request: { headers } },
      )
    ).data;
    expect((await persistence.rules.getById(made.id)).authorKeyId).toBe(
      key.apiKey.id,
    );
    const folio = await createTestFolio(alepha, project);
    await expect(
      api.createAutomation.fetch(
        {
          params: { projectId: project.id },
          body: {
            title: "Too broad",
            rule: {
              ...ast(),
              actions: [
                { kind: "appendFolio", folio: folio.id, text: "No grant" },
              ],
            },
          },
        },
        { request: { headers } },
      ),
    ).rejects.toThrow();
    await rows.keys.updateById(key.apiKey.id, {
      permissions: ["automation:read"],
    });
    await expect(
      api.setAutomationEnabled.fetch(
        {
          params: { projectId: project.id, id: made.id },
          body: { enabled: true, expectedRevision: 0 },
        },
        { request: { headers } },
      ),
    ).rejects.toThrow("automation:write");
    expect((await persistence.rules.getById(made.id)).enabled).toBe(false);
  });
  it("retains OAuth grant identity and refuses client revocation or scope loss without reading secrets", async ({
    expect,
  }) => {
    const oauth = await grant();
    const tokens = await alepha
      .inject(AppSecurityProvider)
      .realm.createToken(
        user,
        { sid: oauth.session.id },
        { clientId: oauth.client.clientId, scopes: ["mcp"] },
      );
    const stored = (
      await api.createAutomation.fetch(
        {
          params: { projectId: project.id },
          body: { title: "OAuth", rule: ast() },
        },
        {
          request: {
            headers: { authorization: `Bearer ${tokens.access_token}` },
          },
        },
      )
    ).data;
    const model = await persistence.rules.getById(stored.id);
    expect(model.authorSessionId).toBe(oauth.session.id);
    expect(JSON.stringify(stored)).not.toContain(oauth.session.refreshToken);
    expect(stored).not.toHaveProperty("authorScope");
    await service.setEnabled(project.id, stored.id, oauth.actor, true, 0);
    await rows.clients.updateById(oauth.client.id, { scopes: ["openid"] });
    await expect(
      alepha
        .inject(AutomationAuthority)
        .check({ automationId: stored.id, revision: 1 }),
    ).rejects.toThrow("automation:write");
    expect((await persistence.rules.getById(stored.id)).requiresApproval).toBe(
      true,
    );
    await rows.clients.updateById(oauth.client.id, {
      scopes: ["mcp"],
      revokedAt: time.nowISOString(),
    });
    await expect(
      service.setEnabled(project.id, stored.id, oauth.actor, true, 1),
    ).rejects.toThrow("client is unavailable");
    const parametersBefore = await rows.parameters.count();
    await rows.clients.updateById(oauth.client.id, { revokedAt: null });
    await rows.sessions.updateById(oauth.session.id, {
      lastUsedAt: time.now().subtract(40, "days").toISOString(),
    });
    await expect(
      service.setEnabled(project.id, stored.id, oauth.actor, true, 1),
    ).rejects.toThrow("idle-expired");
    expect(await rows.parameters.count()).toBe(parametersBefore);
  });
  it("guards concurrent variable editing against rule creation and activation", async ({
    expect,
  }) => {
    const variable = await variables.set(project.id, user, "message", {
      value: { kind: "text", value: "Before" },
    });
    const actor = await manager();
    const rule = ast();
    rule.actions = [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Quest",
        text: "{{message}}",
        category: "automations",
      },
    ];
    alepha.inject(ApiConfigurationRace).before = async () => {
      await variables.set(project.id, actor, "message", {
        id: variable.variable.id,
        version: 0,
        value: { kind: "text", value: "Changed" },
      });
    };
    await expect(
      service.create(project.id, user, { title: "Stale approval", rule }),
    ).rejects.toThrow("configuration changed");
    expect(await persistence.rules.count({ projectId: project.id })).toBe(0);
    const created = await service.create(project.id, user, {
      title: "Current approval",
      rule,
    });
    alepha.inject(ApiConfigurationRace).before = async () => {
      await variables.set(project.id, actor, "message", {
        id: variable.variable.id,
        version: 1,
        value: { kind: "text", value: "Changed again" },
      });
    };
    await expect(
      service.setEnabled(project.id, created.id, user, true, 0),
    ).rejects.toThrow("changed");
    expect(await persistence.rules.getById(created.id)).toMatchObject({
      enabled: false,
      requiresApproval: true,
    });
  });
  it("prevents variable deletion racing an approved consumer and rejects recreated identities", async ({
    expect,
  }) => {
    const variable = await variables.set(project.id, user, "message", {
      value: { kind: "text", value: "Initial" },
    });
    const rule = ast();
    rule.actions = [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Quest",
        text: "{{message}}",
        category: "automations",
      },
    ];
    alepha.inject(ApiConfigurationRace).before = async () => {
      await service.create(project.id, user, {
        title: "Concurrent consumer",
        rule,
      });
    };
    await expect(
      variables.remove(project.id, user, "message", variable.variable.id, 0),
    ).rejects.toThrow("configuration changed");
    expect(
      await persistence.variables.findById(variable.variable.id),
    ).toBeDefined();
    const retained = (await persistence.rules.findMany())[0];
    await service.remove(project.id, retained.id, user, retained.revision);
    await variables.remove(
      project.id,
      user,
      "message",
      variable.variable.id,
      0,
    );
    const recreated = await variables.set(project.id, user, "message", {
      value: { kind: "text", value: "New identity" },
    });
    expect(recreated.variable.id).not.toBe(variable.variable.id);
    await expect(
      variables.set(project.id, user, "message", {
        id: variable.variable.id,
        version: 0,
        value: { kind: "text", value: "Stale client" },
      }),
    ).rejects.toThrow("identity or version");
  });
  it("rolls configuration and transition evidence back when their audit cannot be recorded", async ({
    expect,
  }) => {
    const database = alepha.inject(AutomationDatabase);
    const rule = await create();
    const before = await persistence.rules.getById(rule.id);
    const runs = await persistence.runs.count();
    await database.batch([
      sql`CREATE TRIGGER reject_configuration_audit BEFORE INSERT ON audits WHEN NEW.type = 'automation' BEGIN SELECT RAISE(ABORT, 'configuration audit failed'); END`,
    ]);
    await expect(
      service.create(project.id, user, {
        title: "Must roll back",
        rule: ast(),
      }),
    ).rejects.toThrow("Atomic automation batch failed");
    expect(await persistence.rules.count()).toBe(1);
    await expect(
      service.setEnabled(project.id, rule.id, user, true, 0),
    ).rejects.toThrow("Atomic automation batch failed");
    expect(await persistence.rules.getById(rule.id)).toEqual(before);
    expect(await persistence.runs.count()).toBe(runs);
    await database.batch([sql`DROP TRIGGER reject_configuration_audit`]);
  });
  it("excludes delayed events from an older activation and preserves history after soft deletion", async ({
    expect,
  }) => {
    const rule = await create();
    const earlier = time.nowISOString();
    await time.travel([1, "minute"]);
    const enabled = await service.setEnabled(
      project.id,
      rule.id,
      user,
      true,
      0,
    );
    const oldEvent = await persistence.events.create({
      projectId: project.id,
      identity: crypto.randomUUID(),
      name: "quest.completed",
      occurredAt: earlier,
      replayUntil: time.now().add(90, "days").toISOString(),
      payload: { fields: { title: "Earlier event" }, omitted: [] },
    });
    expect(await alepha.inject(AutomationEvents).sweep(50)).toBe(0);
    expect(
      await persistence.receipts.count({
        automationId: rule.id,
        kind: "occurrence",
      }),
    ).toBe(0);
    expect(
      (await persistence.events.getById(oldEvent.id)).dispatchedAt,
    ).toBeDefined();
    const event = await persistence.events.create({
      projectId: project.id,
      identity: crypto.randomUUID(),
      name: "quest.completed",
      occurredAt: time.nowISOString(),
      replayUntil: time.now().add(90, "days").toISOString(),
      payload: { fields: { title: "Current event" }, omitted: [] },
    });
    const ready = await alepha.inject(AutomationClaims).reserve({
      automationId: rule.id,
      revision: enabled.revision,
      source: { kind: "event", eventId: event.id },
    });
    await service.remove(project.id, rule.id, user, enabled.revision);
    await alepha.inject(AutomationWorker).step({ receiptId: ready.id }, 3);
    const history = (
      await api.listAutomationRuns.fetch(
        {
          params: { projectId: project.id, id: rule.id },
          query: { limit: 50 },
        },
        { user },
      )
    ).data;
    expect(
      history.items.some(
        (run) =>
          run.occurrenceId === ready.occurrenceId &&
          run.status === "refused" &&
          run.snapshot !== null,
      ),
    ).toBe(true);
  });
});

import {
  AutomationAccess,
  AutomationAuthority,
  AutomationCatalog,
  AutomationDatabase,
  AutomationHealth,
  AutomationService,
  AutomationPersistence,
  AutomationRunEvidence,
  AutomationVariables,
  LoreInboxRecipientProvider,
  ProjectCapabilityController,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha, AlephaError } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { apiKeyEntity } from "alepha/api/keys";
import {
  NotificationInboxRecipientProvider,
  notificationInboxEntity,
} from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, sql } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class HealthCatalog extends AutomationCatalog {
  public omitted?: string;
  public override entries() {
    return super.entries().filter((entry) => entry.key !== this.omitted);
  }
}
class RestartedHealth extends AutomationHealth {}

/**
 * Reading the author fails the way a D1 timeout does while `failing` is set:
 * an error that is no refusal, carrying the statement in its message.
 */
class FlakyAccess extends AutomationAccess {
  public failing = false;
  public override async author(
    ...args: Parameters<AutomationAccess["author"]>
  ) {
    if (this.failing)
      throw new AlephaError(
        'D1 query timed out: select "id", "version" from "users" where "id" = ?',
      );
    return super.author(...args);
  }
}

class HealthRepositories {
  public readonly keys = $repository(apiKeyEntity);
  public readonly inbox = $repository(notificationInboxEntity);
  public readonly executions = $repository(jobExecutionEntity);
}

describe("Automation enable intent and health", () => {
  let alepha: Alepha;
  let health: AutomationHealth;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const ast = (): AutomationRule => ({
    version: 1,
    trigger: { kind: "event", event: "feedback.created" },
    select: null,
    guard: null,
    actions: [
      {
        kind: "notify",
        recipient: user.id,
        channel: "inbox",
        title: "Feedback",
        text: "{{title}}",
        category: "automations",
      },
    ],
  });
  const enable = async (id: string, enabled: boolean, actor = user) => {
    const rule = await persistence.rules.getById(id);
    await alepha
      .inject(AutomationService)
      .setEnabled(rule.projectId, id, actor, enabled, rule.revision);
    return persistence.rules.getById(id);
  };
  const create = async (enabled = true) => {
    const row = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Rule",
      rule: ast(),
    });
    return enabled ? enable(row.id, true) : row;
  };
  const capability = (
    key: "plan",
    enabled: boolean,
    options?: Record<string, boolean>,
  ) =>
    alepha.inject(ProjectCapabilityController).setCapability(
      {
        params: { projectId: project.id, key },
        body: { enabled, ...(options ? { options } : {}) },
      },
      { user },
    );
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    })
      .with({ provide: AutomationCatalog, use: HealthCatalog })
      .with({ provide: AutomationAccess, use: FlakyAccess })
      // The app's own entry makes this substitution; without it a
      // `lore-user:` contact resolves to nobody and the push is skipped.
      .with({
        provide: NotificationInboxRecipientProvider,
        use: LoreInboxRecipientProvider,
      });
    bootLore(alepha, ["api"]);
    health = alepha.inject(AutomationHealth);
    persistence = alepha.inject(AutomationPersistence);
    entities = alepha.inject(TestEntityRepositories);
    alepha.inject(HealthRepositories);
    alepha.inject(RestartedHealth);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { feedback: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("shows new rules disabled and restores dependencies without changing enable intent", async ({
    expect,
  }) => {
    const live = await create();
    const disabled = await create(false);
    expect(health.display(disabled)).toBe("disabled");
    await capability("plan", true, { feedback: false });
    expect(await persistence.rules.getById(live.id)).toMatchObject({
      enabled: true,
      health: "broken",
      requiresApproval: false,
    });
    expect(health.display(await persistence.rules.getById(disabled.id))).toBe(
      "disabled",
    );
    await capability("plan", true, { feedback: true });
    expect(await persistence.rules.getById(live.id)).toMatchObject({
      enabled: true,
      health: "active",
    });
    expect(await persistence.rules.getById(disabled.id)).toMatchObject({
      enabled: false,
      health: "active",
    });
  });
  it("revalidates Work immediately when it goes off and comes back", async ({
    expect,
  }) => {
    const rule = await create();
    await capability("plan", false);
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      enabled: true,
      health: "broken",
      reason: "Missing plan capability",
    });
    await expect(
      alepha
        .inject(AutomationAuthority)
        .check({ automationId: rule.id, revision: rule.revision }),
    ).rejects.toThrow("plan");
    await capability("plan", true, { feedback: true });
    expect((await persistence.rules.getById(rule.id)).health).toBe("active");
  });
  it("repairs missed propagation in bounded pages without repeated transition evidence", async ({
    expect,
  }) => {
    const rows = [];
    for (let index = 0; index < 53; index++) rows.push(await create(false));
    await entities.capabilities.updateMany(
      { projectId: { eq: project.id }, key: { eq: "plan" } },
      { options: {} },
    );
    expect(await health.sweep()).toBe(50);
    expect(await persistence.rules.count({ health: "broken" })).toBe(50);
    expect(await alepha.inject(RestartedHealth).sweep()).toBe(50);
    expect(await persistence.rules.count({ health: "broken" })).toBe(53);
    const evidence = await persistence.runs.count({ projectId: project.id });
    await health.sweep();
    await health.sweep();
    await health.sweep();
    expect(await persistence.runs.count({ projectId: project.id })).toBe(
      evidence,
    );
    expect(rows).toHaveLength(53);
  });
  it("keeps removed vocabulary broken until the same entry is restored", async ({
    expect,
  }) => {
    const rule = await create();
    alepha.inject(HealthCatalog).omitted = "feedback.created";
    await health.project(project.id);
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "broken",
      requiresApproval: false,
    });
    alepha.inject(HealthCatalog).omitted = undefined;
    await health.project(project.id);
    expect((await persistence.rules.getById(rule.id)).health).toBe("active");
  });
  it("leaves a rule as it was when the check itself fails, and asks again on the next sweep", async ({
    expect,
  }) => {
    const rule = await create();
    const evidence = await persistence.runs.count({ projectId: project.id });
    const access = alepha.inject(FlakyAccess);

    access.failing = true;
    await health.sweep();
    await health.project(project.id);

    const after = await persistence.rules.getById(rule.id);
    expect(after).toMatchObject({
      enabled: true,
      health: "active",
      requiresApproval: false,
    });
    expect(after.reason ?? null).toBeNull();
    // Not stamped either, so the sweep takes it first next time.
    expect(after.healthCheckedAt).toBe(rule.healthCheckedAt);
    expect(await persistence.runs.count({ projectId: project.id })).toBe(
      evidence,
    );
    expect(await alepha.inject(HealthRepositories).inbox.count()).toBe(0);

    access.failing = false;
    await health.sweep();
    expect((await persistence.rules.getById(rule.id)).health).toBe("active");
  });
  it("lifts a pause an earlier failed check left behind, whose reason is a statement", async ({
    expect,
  }) => {
    const rule = await create();
    await persistence.rules.updateById(rule.id, {
      health: "paused",
      requiresApproval: true,
      reason:
        'D1 query timed out: select "id", "version", "createdAt" from "users" where "id" = ?',
    });

    await health.sweep();

    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "active",
      requiresApproval: false,
    });
  });
  it("tells the author once when their rule pauses for approval, and once when it breaks", async ({
    expect,
  }) => {
    const rule = await create();
    const rows = alepha.inject(HealthRepositories);
    // The push is a job, drained in this process by the job layer's direct
    // mode: wait for every execution to end before counting what arrived.
    const messages = async () => {
      const terminal = new Set(["ok", "error", "cancelled"]);
      for (let attempt = 0; attempt < 100; attempt++) {
        const pending = (await rows.executions.findMany()).filter(
          (row) => !terminal.has(String(row.status)),
        );
        if (pending.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return (await rows.inbox.findMany({ orderBy: "createdAt" })).map(
        (row) => row.title,
      );
    };
    const key = await rows.keys.create({
      userId: user.id,
      name: "Scoped",
      tokenHash: crypto.randomUUID(),
      tokenPrefix: "test",
      tokenSuffix: "test",
      roles: ["user"],
    });
    await persistence.rules.updateById(rule.id, { authorKeyId: key.id });
    await rows.keys.updateById(key.id, {
      revokedAt: alepha.inject(DateTimeProvider).nowISOString(),
    });

    await health.project(project.id);
    expect((await persistence.rules.getById(rule.id)).health).toBe("paused");
    expect(await messages()).toEqual(["Rule is paused until you review it"]);

    // Every later sweep finds the same paused rule, and says nothing.
    await health.sweep();
    await health.project(project.id);
    expect(await messages()).toHaveLength(1);
    const [message] = await rows.inbox.findMany();
    expect(message).toMatchObject({
      userId: user.id,
      href: `/${project.slug}/automations/${rule.id}`,
    });

    // A second rule, healthy until what it depends on goes away.
    const other = await create();
    await capability("plan", true, { feedback: false });
    expect((await persistence.rules.getById(other.id)).health).toBe("broken");
    expect(await messages()).toEqual([
      "Rule is paused until you review it",
      "Rule is broken",
    ]);
    await health.sweep();
    expect(await messages()).toHaveLength(2);
  });
  it("retains a security pause across capability loss and restoration until valid explicit enable", async ({
    expect,
  }) => {
    const rule = await create();
    const keys = alepha.inject(HealthRepositories).keys;
    const key = await keys.create({
      userId: user.id,
      name: "Scoped",
      tokenHash: crypto.randomUUID(),
      tokenPrefix: "test",
      tokenSuffix: "test",
      roles: ["user"],
    });
    await persistence.rules.updateById(rule.id, { authorKeyId: key.id });
    await keys.updateById(key.id, {
      revokedAt: alepha.inject(DateTimeProvider).nowISOString(),
    });
    await health.project(project.id);
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      enabled: true,
      health: "paused",
      requiresApproval: true,
    });
    await capability("plan", true, { feedback: false });
    await capability("plan", true, { feedback: true });
    await expect(
      enable(rule.id, true, {
        ...user,
        credential: { type: "api-key", id: key.id },
      }),
    ).rejects.toThrow("revoked");
    await keys.updateById(key.id, { revokedAt: null });
    await health.project(project.id);
    expect((await persistence.rules.getById(rule.id)).health).toBe("paused");
    expect(await enable(rule.id, true)).toMatchObject({
      enabled: true,
      health: "active",
      requiresApproval: false,
    });
  });
  it("records membership removal once and requires review even if the author rejoins", async ({
    expect,
  }) => {
    const rule = await create();
    await entities.organizationMembers.deleteMany({
      organizationId: project.organizationId!,
      userId: user.id,
    });
    await alepha.events.emit("organization:member:removed", {
      organizationId: project.organizationId!,
      userId: user.id,
      actor: { id: user.id },
      leave: false,
    });
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
    });
    const count = await persistence.runs.count({ projectId: project.id });
    await alepha.events.emit("organization:member:removed", {
      organizationId: project.organizationId!,
      userId: user.id,
      actor: { id: user.id },
      leave: false,
    });
    expect(await persistence.runs.count({ projectId: project.id })).toBe(count);
    await createTestMember(alepha, project, user.id, { rank: "owner" });
    await health.project(project.id);
    expect((await persistence.rules.getById(rule.id)).health).toBe("paused");
    await enable(rule.id, true);
    expect((await persistence.rules.getById(rule.id)).health).toBe("active");
  });
  it("records a foreign variable review once and never clears it during reconciliation", async ({
    expect,
  }) => {
    const variables = alepha.inject(AutomationVariables);
    await variables.set(project.id, user, {
      key: "message",
      value: { kind: "text", value: "Before" },
    });
    const config = ast();
    config.actions[0] = {
      ...config.actions[0],
      text: "{{message}}",
    } as (typeof config.actions)[0];
    const rule = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Shared",
      rule: config,
    });
    await enable(rule.id, true);
    const manager = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, manager.id, { rank: "admin" });
    await variables.set(
      project.id,
      { id: manager.id, roles: ["user"] },
      { key: "message", version: 0, value: { kind: "text", value: "After" } },
    );
    expect(await persistence.rules.getById(rule.id)).toMatchObject({
      health: "paused",
      requiresApproval: true,
    });
    const count = await persistence.runs.count({ projectId: project.id });
    await health.project(project.id);
    expect(await persistence.runs.count({ projectId: project.id })).toBe(count);
    await enable(rule.id, true);
    expect((await persistence.rules.getById(rule.id)).health).toBe("active");
  });
  it("blocks following actions after disable, preserves review state and advances the revision", async ({
    expect,
  }) => {
    const rule = await create();
    const disabled = await enable(rule.id, false);
    expect(disabled.revision).toBe(rule.revision + 1);
    expect(health.display(disabled)).toBe("disabled");
    await expect(
      alepha
        .inject(AutomationAuthority)
        .check({ automationId: rule.id, revision: rule.revision }),
    ).rejects.toThrow("disabled");
    await health.project(project.id);
    expect((await persistence.rules.getById(rule.id)).enabled).toBe(false);
  });
  it("keeps read-only inspection and authority refusal free of health evidence writes", async ({
    expect,
  }) => {
    const rule = await create();
    await entities.capabilities.updateMany(
      { projectId: { eq: project.id }, key: { eq: "plan" } },
      { options: {} },
    );
    const before = await persistence.rules.getById(rule.id);
    const count = await persistence.runs.count({ projectId: project.id });
    expect((await health.inspect(before)).health).toBe("broken");
    await expect(
      alepha.inject(AutomationAuthority).check({
        automationId: rule.id,
        revision: rule.revision,
        readOnly: true,
      }),
    ).rejects.toThrow("plan.feedback");
    expect(await persistence.rules.getById(rule.id)).toEqual(before);
    expect(await persistence.runs.count({ projectId: project.id })).toBe(count);
  });
  it("binds health and its transition evidence atomically and ignores stale validation", async ({
    expect,
  }) => {
    const rule = await create();
    const database = alepha.inject(AutomationDatabase);
    await database.batch([
      sql`CREATE TRIGGER refuse_health BEFORE INSERT ON automation_runs BEGIN SELECT RAISE(ABORT, 'refuse health'); END`,
    ]);
    await expect(
      alepha
        .inject(AutomationRunEvidence)
        .transition(rule.id, "broken", "Dependency unavailable", false),
    ).rejects.toThrow("Atomic automation batch failed");
    expect(await persistence.rules.getById(rule.id)).toEqual(rule);
    await database.batch([sql`DROP TRIGGER refuse_health`]);
    await enable(rule.id, false);
    await health.reconcile(rule);
    expect((await persistence.rules.getById(rule.id)).enabled).toBe(false);
  });
});

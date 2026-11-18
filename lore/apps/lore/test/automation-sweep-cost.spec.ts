import {
  AutomationDependencies,
  AutomationDispatchRegistry,
  AutomationHealth,
  AutomationPersistence,
  AutomationService,
  LoreInboxRecipientProvider,
} from "@lore/core/api";
import { automationLine, createPresetRanks } from "@lore/core/testing";
import { $hook, Alepha } from "alepha";
import { NotificationInboxRecipientProvider } from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * Every statement the container issues, reads and writes, by table: what a
 * tick costs on D1, where each one is a round trip to the primary.
 */
class StatementCounter {
  public readonly byTable = new Map<string, number>();
  protected count(tableName: string) {
    this.byTable.set(tableName, (this.byTable.get(tableName) ?? 0) + 1);
  }
  protected readonly onRead = $hook({
    on: "repository:read:before",
    handler: ({ tableName }) => this.count(tableName),
  });
  protected readonly onCreate = $hook({
    on: "repository:create:before",
    handler: ({ tableName }) => this.count(tableName),
  });
  protected readonly onUpdate = $hook({
    on: "repository:update:before",
    handler: ({ tableName }) => this.count(tableName),
  });
  protected readonly onDelete = $hook({
    on: "repository:delete:before",
    handler: ({ tableName }) => this.count(tableName),
  });
  public get total(): number {
    return [...this.byTable.values()].reduce((sum, n) => sum + n, 0);
  }
  public reset(): void {
    this.byTable.clear();
  }
}

/**
 * Counts the dependency verdicts passes: what a reconcile pays in
 * capabilities, channels and variables reads.
 */
class CountingDependencies extends AutomationDependencies {
  public passes = 0;
  protected override async verdicts(
    ...args: Parameters<AutomationDependencies["verdicts"]>
  ) {
    this.passes++;
    return super.verdicts(...args);
  }
}

/**
 * The cost of `automations.dispatch`, the `*\/5` cron (#Q3827): the health
 * sweep and the dispatch tick, counted apart, for a fixed number of rules.
 *
 * Production measured about 75 statements per rule per tick before this:
 * the sweep re-checked every rule's authority every five minutes whether
 * anything had changed or not. A tick with nothing due and nothing changed
 * must cost the same for 3 rules as for 9.
 */
describe("automations.dispatch cost", () => {
  let alepha: Alepha;
  let health: AutomationHealth;
  let persistence: AutomationPersistence;
  let counter: StatementCounter;
  let registry: AutomationDispatchRegistry;
  let service: AutomationService;
  let entities: TestEntityRepositories;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;

  const create = async () => {
    const row = await persistence.rules.create({
      projectId: project.id,
      authorUserId: user.id,
      title: "Rule",
      rule: automationLine({
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
      }),
    });
    await service.setEnabled(project.id, row.id, user, true, row.revision);
  };

  /**
   * The statements of one sweep and of one dispatch tick, after `rules`
   * rules were created and checked once.
   */
  const measure = async (rules: number) => {
    for (let index = 0; index < rules; index++) await create();
    // Every rule due: never checked by a sweep yet.
    counter.reset();
    await health.sweep();
    const due = counter.total;
    const dueByTable = Object.fromEntries(counter.byTable);
    // Every rule checked a moment ago: the steady state of a quiet project.
    counter.reset();
    await health.sweep();
    const sweep = counter.total;
    counter.reset();
    await registry.tick(0);
    const tick = counter.total;
    return { due, dueByTable, sweep, tick };
  };

  const boot = async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    })
      .with({
        provide: NotificationInboxRecipientProvider,
        use: LoreInboxRecipientProvider,
      })
      .with({ provide: AutomationDependencies, use: CountingDependencies })
      .with(StatementCounter);
    bootLore(alepha, ["api"]);
    health = alepha.inject(AutomationHealth);
    persistence = alepha.inject(AutomationPersistence);
    registry = alepha.inject(AutomationDispatchRegistry);
    service = alepha.inject(AutomationService);
    entities = alepha.inject(TestEntityRepositories);
    counter = alepha.inject(StatementCounter);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { feedback: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  };

  beforeEach(boot);

  afterEach(async () => {
    await alepha.stop();
  });

  /**
   * Measured on 2026-11-18, before the change: the tick 5 statements for 3
   * and for 9 rules, the sweep 1 + 27 per rule, every tick. After it, a
   * quiet tick is 1 + 5, and a rule due for its hourly check 21.
   */
  it("counts the sweep and the dispatch tick apart, and neither grows with the rules once checked", async ({
    expect,
  }) => {
    const three = await measure(3);
    await alepha.stop();
    // A fresh container for the second count, so nothing is warm.
    await boot();
    const nine = await measure(9);

    // Due rules are still checked, every one of them.
    expect(nine.due).toBeGreaterThan(three.due);
    // Checked a moment ago: the sweep's own select, and nothing per rule.
    expect(three.sweep).toBe(1);
    expect(nine.sweep).toBe(1);
    // The dispatch tick has nothing due and reads no rule.
    expect(nine.tick).toBe(three.tick);
  });

  it("checks a rule again once its health is an hour old", async ({
    expect,
  }) => {
    await create();
    expect(await health.sweep()).toBe(1);
    expect(await health.sweep()).toBe(0);
    // Backdated rather than `travel()`, which would fire the `*\/5` cron
    // and sweep on its own.
    const [rule] = await persistence.rules.findMany({ where: {}, limit: 1 });
    const now = alepha.inject(DateTimeProvider).nowMillis();
    await persistence.rules.updateById(rule.id, {
      healthCheckedAt: now - AutomationHealth.RECHECK_AFTER_MS + 1_000,
    });
    expect(await health.sweep()).toBe(0);
    await persistence.rules.updateById(rule.id, {
      healthCheckedAt: now - AutomationHealth.RECHECK_AFTER_MS - 1_000,
    });
    expect(await health.sweep()).toBe(1);
  });

  it("computes a rule's dependency verdicts once per reconcile", async ({
    expect,
  }) => {
    await create();
    const [rule] = await persistence.rules.findMany({ where: {}, limit: 1 });
    const dependencies = alepha.inject(CountingDependencies);
    dependencies.passes = 0;
    await health.reconcile(rule);
    expect(dependencies.passes).toBe(1);
  });
});

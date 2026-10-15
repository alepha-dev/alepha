import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AutomationAtomic,
  AutomationClaims,
  AutomationD1Provider,
  AutomationEvents,
  AutomationPersistence,
  AutomationRoster,
  AutomationRunEvidence,
} from "@lore/core/api";
import type { AutomationRule } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DatabaseProvider, sql, type D1Database } from "alepha/orm";
import { afterEach, beforeAll, describe, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  TestEntityRepositories,
  createTestProject,
} from "./fixtures/entities.ts";

class FixtureD1Provider extends AutomationD1Provider {
  public schemaStatements: string[] = [];
  public override async migrate(): Promise<void> {
    for (let index = 0; index < this.schemaStatements.length; index += 50)
      await this.atomicBatch(this.schemaStatements.slice(index, index + 50));
  }
}

describe("Durable automation primitives on local D1", () => {
  let schemaStatements: string[];
  let directory: string | undefined;
  let proxy:
    | Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>
    | undefined;
  let alepha: Alepha | undefined;

  beforeAll(async () => {
    // Build the complete real model once, then apply that same SQLite DDL to
    // Wrangler's D1 binding. These tests exercise D1 batch, not a fake driver.
    const template = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "error" },
    });
    bootLore(template, ["api"]);
    template.inject(TestEntityRepositories);
    const provider = template.inject(DatabaseProvider);
    await template.start();
    try {
      const rows = await provider.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
      );
      schemaStatements = rows.map((row) => String(row.sql));
    } finally {
      await template.stop();
    }
  });
  afterEach(async () => {
    try {
      await alepha?.stop();
    } finally {
      await proxy?.dispose();
      if (directory) await rm(directory, { recursive: true, force: true });
      alepha = undefined;
      proxy = undefined;
      directory = undefined;
    }
  });

  for (const mode of ["primary", "sessions"] as const) {
    it(`preserves atomic intents, claims, effects and full roster snapshots with ${mode} reads`, async ({
      expect,
    }) => {
      directory = await mkdtemp(join(tmpdir(), "lore-durable-d1-"));
      const path = join(directory, "wrangler.json");
      await writeFile(
        path,
        JSON.stringify({
          name: "lore-durable-d1-test",
          compatibility_date: "2026-01-01",
          d1_databases: [
            {
              binding: "DB",
              database_name: "automation-test",
              database_id: crypto.randomUUID(),
            },
          ],
        }),
      );
      proxy = await getPlatformProxy<{ DB: D1Database }>({
        configPath: path,
        persist: false,
        remoteBindings: false,
      });
      alepha = Alepha.create({
        env: {
          DATABASE_URL: "d1://DB",
          DATABASE_D1_MODE: mode,
          SERVER_PORT: 0,
          LOG_LEVEL: "error",
        },
      }).with({ provide: DatabaseProvider, use: FixtureD1Provider });
      alepha.set("cloudflare.env", proxy.env);
      bootLore(alepha, ["api"]);
      const provider = alepha.inject(DatabaseProvider) as FixtureD1Provider;
      provider.schemaStatements = schemaStatements;
      const entities = alepha.inject(TestEntityRepositories);
      const persistence = alepha.inject(AutomationPersistence);
      const events = alepha.inject(AutomationEvents);
      const claims = alepha.inject(AutomationClaims);
      const evidence = alepha.inject(AutomationRunEvidence);
      const atomic = alepha.inject(AutomationAtomic);
      const rosterService = alepha.inject(AutomationRoster);
      await alepha.start();
      const project = await createTestProject(alepha, {
        capabilities: [
          { key: "work", options: { automations: true } },
          { key: "support" },
        ],
      });
      await entities.users.updateById(project.createdBy, { roles: ["user"] });
      await provider.execute(
        "CREATE TABLE automation_d1_effects (id TEXT PRIMARY KEY NOT NULL, hits INTEGER NOT NULL)",
      );
      const rule: AutomationRule = {
        version: 1,
        trigger: { kind: "event", event: "feedback.created" },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            recipient: project.createdBy,
            channel: "inbox",
            title: "Source",
            text: "{{title}}",
            category: "automations",
          },
        ],
      };
      const created = await persistence.rules.create({
        projectId: project.id,
        authorUserId: project.createdBy,
        title: "D1 rule",
        rule,
      });
      const enabled = await persistence.rules.updateById(created.id, {
        enabled: true,
      });
      await expect(
        atomic.guarded(project.id, sql`FALSE`, [
          sql`INSERT INTO automation_d1_effects VALUES ('lost-claim', 1)`,
        ]),
      ).rejects.toThrow("Atomic automation batch failed");
      const source = await events.transition({
        projectId: project.id,
        identity: "d1-source",
        name: "feedback.created",
        fields: { title: "Safe", reporter_email: "private@example.test" },
        condition: sql`NOT EXISTS (SELECT 1 FROM automation_d1_effects WHERE id = 'source')`,
        mutation: sql`INSERT INTO automation_d1_effects VALUES ('source', 1) RETURNING id`,
        changedTables: ["automation_d1_effects"],
      });
      expect(source.event.payload.fields).toEqual({ title: "Safe" });
      const prepared = await evidence.prepare({
        rule: enabled,
        occurrenceId: `event:${source.event.id}`,
        triggeredAt: source.event.occurredAt,
        inputs: source.event.payload.fields,
        selected: [source.event.payload.fields],
        matched: 1,
        planned: [{ index: 0 }],
      });
      const request = {
        automationId: enabled.id,
        revision: 0,
        source: { kind: "event" as const, eventId: source.event.id },
        prepared,
      };
      const reserved = await claims.reserve({
        automationId: enabled.id,
        revision: 0,
        source: { kind: "event", eventId: source.event.id },
      });
      expect(reserved.status).toBe("ready");
      const first = await claims.claim(request);
      expect(first.state).toBe("claimed");
      let occurrence = first.receipt!;
      expect((await claims.claim(request)).state).toBe("busy");
      await persistence.receipts.updateById(occurrence.id, {
        leaseUntil: alepha
          .inject(DateTimeProvider)
          .now()
          .subtract(3, "minutes")
          .toISOString(),
      });
      const oldToken = occurrence.leaseToken!;
      occurrence = (await claims.claim(request)).receipt!;
      const action = {
        kind: "notify" as const,
        recipient: project.createdBy,
        channel: "inbox",
        title: "Source",
        text: "Safe",
        category: "automations" as const,
      };
      await expect(
        claims.atomicEffect(occurrence.id, oldToken, {
          index: 0,
          action,
          statements: [
            sql`INSERT INTO automation_d1_effects VALUES ('old-worker', 1)`,
          ],
          result: { changed: true },
        }),
      ).rejects.toThrow("lease");
      const effect = {
        index: 0,
        action,
        statements: [
          sql`INSERT INTO automation_d1_effects VALUES ('effect', 1) ON CONFLICT (id) DO UPDATE SET hits = automation_d1_effects.hits + 1`,
        ],
        result: { changed: true },
      };
      await expect(
        claims.atomicEffect(occurrence.id, occurrence.leaseToken!, {
          ...effect,
          statements: [
            ...effect.statements,
            sql`INSERT INTO automation_d1_effects VALUES ('source', 99)`,
          ],
        }),
      ).rejects.toThrow("Atomic automation batch failed");
      expect(
        await provider.execute(
          "SELECT COUNT(*) AS n FROM automation_d1_effects WHERE id = 'effect'",
        ),
      ).toEqual([{ n: 0 }]);
      const committed = await claims.atomicEffect(
        occurrence.id,
        occurrence.leaseToken!,
        effect,
      );
      expect(
        (
          await claims.atomicEffect(
            occurrence.id,
            occurrence.leaseToken!,
            effect,
          )
        ).id,
      ).toBe(committed.id);
      expect(
        await provider.execute(
          "SELECT hits FROM automation_d1_effects WHERE id = 'effect'",
        ),
      ).toEqual([{ hits: 1 }]);
      // Freezing targets is independent of transport execution. A later member
      // is excluded from the already-frozen recipient/channel cross product.
      const member = await entities.users.create({ roles: ["user"] });
      await entities.organizationMembers.create({
        organizationId: project.organizationId!,
        userId: member.id,
        rank: "owner",
      });
      const roster = await rosterService.freeze(
        occurrence.id,
        occurrence.leaseToken!,
        {
          index: 0,
          channels: ["inbox", "email"],
          excludeUserId: project.createdBy,
        },
      );
      const late = await entities.users.create({ roles: ["user"] });
      await entities.organizationMembers.create({
        organizationId: project.organizationId!,
        userId: late.id,
        rank: "owner",
      });
      const page = await rosterService.page(roster.id, occurrence.leaseToken!);
      expect(page.total).toBe(2);
      expect(
        page.recipients.map((recipient) => recipient.recipientUserId),
      ).toEqual([member.id, member.id]);
      expect(
        new Set(page.recipients.map((recipient) => recipient.recipientChannel)),
      ).toEqual(new Set(["email", "inbox"]));
      await entities.organizationMembers.deleteMany({
        organizationId: project.organizationId!,
        userId: project.createdBy,
      });
      await expect(
        claims.lease(occurrence.id, occurrence.leaseToken!),
      ).rejects.toThrow("current member");
      expect(await persistence.rules.getById(enabled.id)).toMatchObject({
        health: "paused",
        requiresApproval: true,
      });
    }, 120_000);
  }
});

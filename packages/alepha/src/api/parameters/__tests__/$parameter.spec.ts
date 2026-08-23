import { Alepha, jsonSchemaToZod, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { currentTenantAtom } from "alepha/security";
import { describe, expect, it } from "vitest";

import {
  $parameter,
  AlephaApiParameters,
  ParameterProvider,
} from "../index.ts";

const featureSchema = z.object({
  enableBeta: z.boolean(),
  maxUploadSize: z.number(),
});

describe("$parameter", () => {
  it("should initialize with default value", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.flags",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    expect(await config.features.get()).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });
  });

  it("should set and persist parameter", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.flags",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    await config.features.set({
      enableBeta: true,
      maxUploadSize: 20971520,
    });

    expect(await config.features.get()).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });

    // Verify persisted to database
    const provider = alepha.inject(ParameterProvider);
    const history = await provider.getHistory("app.features.flags");
    expect(history.length).toBe(1);
    expect(history[0].content).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });
  });

  it("should load from database on start", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.load",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    // First, seed the database with a value different from default
    const provider = alepha.inject(ParameterProvider);
    await provider.save(
      "app.features.load",
      { enableBeta: true, maxUploadSize: 5242880 },
      "test-hash",
    );

    // Manually reload the parameter primitive
    const config = alepha.inject(AppConfig);
    await config.features.reload();

    // Should have loaded from database, not default
    expect(await config.features.get()).toEqual({
      enableBeta: true,
      maxUploadSize: 5242880,
    });
  });

  it("should maintain version history", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.history",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    // Make multiple changes
    await config.features.set({ enableBeta: true, maxUploadSize: 1 });
    await config.features.set({ enableBeta: false, maxUploadSize: 2 });
    await config.features.set({ enableBeta: true, maxUploadSize: 3 });

    const history = await config.features.getHistory();
    expect(history.length).toBe(3);
    expect(history[0].version).toBe(3);
    expect(history[1].version).toBe(2);
    expect(history[2].version).toBe(1);
  });

  it("should support rollback to previous version", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.rollback",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    await config.features.set({ enableBeta: true, maxUploadSize: 100 });
    await config.features.set({ enableBeta: false, maxUploadSize: 200 });
    await config.features.set({ enableBeta: true, maxUploadSize: 300 });

    // Rollback to version 1
    await config.features.rollback(1);

    expect(await config.features.get()).toEqual({
      enableBeta: true,
      maxUploadSize: 100,
    });

    // Should have created a new version (4)
    const history = await config.features.getHistory();
    expect(history.length).toBe(4);
  });

  it("should support change description", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.description",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    await config.features.set(
      { enableBeta: true, maxUploadSize: 20971520 },
      { changeDescription: "Enable beta features for testing" },
    );

    const history = await config.features.getHistory();
    expect(history[0].changeDescription).toBe(
      "Enable beta features for testing",
    );
  });

  it("should support user tracking", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.user",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    const userId = "550e8400-e29b-41d4-a716-446655440000";
    await config.features.set(
      { enableBeta: true, maxUploadSize: 20971520 },
      {
        user: {
          id: userId,
          email: "admin@example.com",
          name: "Admin User",
        },
      },
    );

    const history = await config.features.getHistory();
    expect(history[0].creatorId).toBe(userId);
    expect(history[0].creatorName).toBe("Admin User");
  });

  it("should subscribe and unsubscribe to changes", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.sub",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    const received: unknown[] = [];
    const unsub = config.features.sub((value) => {
      received.push(value);
    });

    await config.features.set({ enableBeta: true, maxUploadSize: 1 });
    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ enableBeta: true, maxUploadSize: 1 });

    // Unsubscribe
    unsub();

    await config.features.set({ enableBeta: false, maxUploadSize: 2 });
    // Should not receive after unsubscribe
    expect(received.length).toBe(1);
  });

  it("should promote cached next to current when time passes", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);

    class AppConfig {
      features = $parameter({
        name: "app.features.timetravel",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const dateTime = alepha.inject(DateTimeProvider);

    // Set current value
    await config.features.set({ enableBeta: false, maxUploadSize: 100 });

    // Schedule a future value +1h from now
    const futureDate = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    );
    await config.features.set(
      { enableBeta: true, maxUploadSize: 999 },
      { activationDate: futureDate },
    );

    // Reload to pick up the next version
    await config.features.reload();

    // Currently should still be the old value
    expect(await config.features.get()).toEqual({
      enableBeta: false,
      maxUploadSize: 100,
    });

    // Travel past the activation date
    await dateTime.travel(2, "hours");

    // Now get() should promote the next to current
    expect(await config.features.get()).toEqual({
      enableBeta: true,
      maxUploadSize: 999,
    });
  });
});

describe("ParameterProvider", () => {
  it("should build parameter tree from names", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("app.features.flags", { enabled: true }, "hash1");
    await provider.save("app.features.limits", { max: 100 }, "hash2");
    await provider.save("app.pricing.tiers", { basic: 10 }, "hash3");
    await provider.save("system.logging", { level: "info" }, "hash4");

    const tree = await provider.getParameterTree();

    expect(tree.length).toBe(2); // app, system
    expect(tree[0].name).toBe("app");
    expect(tree[0].isLeaf).toBe(false);
    expect(tree[0].children.length).toBe(2); // features, pricing

    const features = tree[0].children.find((c) => c.name === "features");
    expect(features?.children.length).toBe(2); // flags, limits
  });

  it("should calculate statuses correctly", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    // Create first version (current — immediate activation)
    const v1 = await provider.save("test.status.param", { value: 1 }, "hash");
    expect(v1.status).toBe("current");

    // Create second version (becomes current, first becomes expired)
    const v2 = await provider.save("test.status.param", { value: 2 }, "hash");
    expect(v2.status).toBe("current");

    // Verify calculated statuses
    const history = await provider.getHistory("test.status.param");
    const withStatuses = provider.calculateStatuses(history);
    const v1Status = withStatuses.find((v) => v.version === 1);
    const v2Status = withStatuses.find((v) => v.version === 2);
    expect(v1Status?.status).toBe("expired");
    expect(v2Status?.status).toBe("current");
  });

  it("should calculate future and next statuses", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const dateTime = alepha.inject(DateTimeProvider);

    // Create current version
    await provider.save("test.future.param", { value: 1 }, "hash");

    // Create future versions
    const futureDate1 = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    ); // +1h
    const futureDate2 = new Date(
      dateTime.now().toDate().getTime() + 2 * 60 * 60 * 1000,
    ); // +2h

    await provider.save("test.future.param", { value: 2 }, "hash", {
      activationDate: futureDate1,
    });
    await provider.save("test.future.param", { value: 3 }, "hash", {
      activationDate: futureDate2,
    });

    const history = await provider.getHistory("test.future.param");
    const withStatuses = provider.calculateStatuses(history);

    const v1 = withStatuses.find((v) => v.version === 1);
    const v2 = withStatuses.find((v) => v.version === 2);
    const v3 = withStatuses.find((v) => v.version === 3);

    expect(v1?.status).toBe("current");
    expect(v2?.status).toBe("next");
    expect(v3?.status).toBe("future");
  });

  it("should detect schema migration", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("migration.param", { v: 1 }, "hash-v1");
    const v2 = await provider.save(
      "migration.param",
      { v: 2, extra: true },
      "hash-v2",
    );

    expect(v2.migrationLog).toContain("Schema changed");
    expect(v2.migrationLog).toContain("hash-v1");
    expect(v2.migrationLog).toContain("hash-v2");
  });

  it("should store previous content for rollback", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("previous.param", { old: true }, "hash");
    const v2 = await provider.save("previous.param", { new: true }, "hash");

    expect(v2.previousContent).toEqual({ old: true });
  });

  it("should get all parameter names", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("names.alpha", { a: 1 }, "h1");
    await provider.save("names.beta", { b: 1 }, "h2");
    await provider.save("names.alpha", { a: 2 }, "h1"); // Second version

    const names = await provider.getParameterNames();

    expect(names).toContain("names.alpha");
    expect(names).toContain("names.beta");
  });

  it("should load current and next from database", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const dateTime = alepha.inject(DateTimeProvider);

    // Create current and future versions
    await provider.save("test.loadcn.param", { value: "current" }, "hash");
    const futureDate = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    );
    await provider.save("test.loadcn.param", { value: "next" }, "hash", {
      activationDate: futureDate,
    });

    const { current, next } =
      await provider.loadCurrentAndNext("test.loadcn.param");

    expect(current).not.toBeNull();
    expect(current?.content).toEqual({ value: "current" });
    expect(next).not.toBeNull();
    expect(next?.content).toEqual({ value: "next" });
  });

  it("should resolve the version in force at a given instant", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const dateTime = alepha.inject(DateTimeProvider);
    const name = "test.at.param";
    const now = dateTime.now().toDate().getTime();
    const hour = 60 * 60 * 1000;

    // v1 live two hours ago, v2 live one hour ago, v3 scheduled in an hour.
    await provider.save(name, { value: "v1" }, "hash", {
      activationDate: new Date(now - 2 * hour),
    });
    await provider.save(name, { value: "v2" }, "hash", {
      activationDate: new Date(now - hour),
    });
    await provider.save(name, { value: "v3" }, "hash", {
      activationDate: new Date(now + hour),
    });

    // An event captured 90 minutes ago must be evaluated with v1 — what was
    // live then — even though `get()` returns v2 now.
    expect(
      (await provider.getVersionAt(name, new Date(now - 90 * 60 * 1000)))
        ?.content,
    ).toEqual({ value: "v1" });

    // Now resolves to v2; the scheduled v3 never leaks into an earlier read.
    expect((await provider.getVersionAt(name, new Date(now)))?.content).toEqual(
      {
        value: "v2",
      },
    );
    expect(
      (await provider.getVersionAt(name, new Date(now + 30 * 60 * 1000)))
        ?.content,
    ).toEqual({ value: "v2" });

    // Once v3's activation passes it takes over.
    expect(
      (await provider.getVersionAt(name, new Date(now + 2 * hour)))?.content,
    ).toEqual({ value: "v3" });

    // Before the first version there is nothing to resolve.
    expect(
      await provider.getVersionAt(name, new Date(now - 3 * hour)),
    ).toBeNull();

    // ISO strings are accepted too — the wire format of most event payloads.
    expect(
      (await provider.getVersionAt(name, new Date(now).toISOString()))?.content,
    ).toEqual({ value: "v2" });
  });
});

describe("Cross-instance sync", () => {
  it("should pick up changes via load() when database is updated externally", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.sync",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Should start with default
    expect(await config.features.get()).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });

    // Simulate another instance writing to DB (bypass primitive, use provider directly)
    await provider.save(
      "app.features.sync",
      { enableBeta: true, maxUploadSize: 20971520 },
      "external-hash",
    );

    // Primitive still has cached default (hasn't reloaded)
    expect(config.features.cachedCurrentContent).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });

    // Call load() to pick up the database change
    await config.features.load();

    // Should now have the updated value
    expect(await config.features.get()).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });
  });

  it("should ignore sync messages from self via instanceId", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.selfignore",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    // Get the provider's instanceId (protected but accessible for testing)
    const providerAny = provider as any;
    const selfInstanceId = providerAny.instanceId;

    // Simulate receiving a change notification from self (should be ignored)
    const selfPayload = {
      name: "app.features.selfignore",
      instanceId: selfInstanceId,
    };

    // Call the handler directly
    await providerAny.handleChangeNotification(selfPayload);

    // Value should NOT have changed (self-messages are ignored)
    const config = alepha.inject(AppConfig);
    expect(await config.features.get()).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });

    // Simulate receiving a change notification from another instance
    // First, seed a value in the database so load() finds something
    await provider.save(
      "app.features.selfignore",
      { enableBeta: true, maxUploadSize: 999 },
      "hash",
    );

    const otherPayload = {
      name: "app.features.selfignore",
      instanceId: "other-instance-id",
    };

    await providerAny.handleChangeNotification(otherPayload);

    // Value should now be updated (loaded from DB)
    expect(await config.features.get()).toEqual({
      enableBeta: true,
      maxUploadSize: 999,
    });
  });
});

describe("Schema migration", () => {
  it("should keep valid value when schema is compatible", async () => {
    const schema = z.object({
      name: z.text(),
      age: z.number().optional(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.compatible",
        schema,
        default: { name: "default" },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Seed database with a value that has a different schema hash
    await provider.save("migrate.compatible", { name: "jack" }, "old-hash");

    // Reload — the value is still valid against the new schema
    await config.param.reload();

    expect(await config.param.get()).toEqual({ name: "jack" });

    // No new version should be created (still just 1)
    const history = await provider.getHistory("migrate.compatible");
    expect(history.length).toBe(1);
  });

  it("should merge with defaults when adding a required field", async () => {
    const schema = z.object({
      name: z.text(),
      age: z.number(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.add.field",
        schema,
        default: { name: "default", age: 25 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Seed database with a value missing the "age" field, different schema hash
    await provider.save("migrate.add.field", { name: "jack" }, "old-hash");

    // Reload — value is invalid (missing required "age"), should merge with defaults
    await config.param.reload();

    expect(await config.param.get()).toEqual({ name: "jack", age: 25 });

    // A new version should be auto-created
    const history = await provider.getHistory("migrate.add.field");
    expect(history.length).toBe(2);
    expect(history[0].changeDescription).toContain("Auto-migrated");
    expect(history[0].changeDescription).toContain("merged with defaults");
  });

  it("should reset to defaults when merge still invalid", async () => {
    const schema = z.object({
      items: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
        }),
      ),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.reset.defaults",
        schema,
        default: { items: [{ x: 0, y: 0 }] },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Seed database with invalid nested value, different schema hash
    await provider.save(
      "migrate.reset.defaults",
      { items: [{ x: 1 }] },
      "old-hash",
    );

    // Reload — merge still invalid (nested object missing "y"), should reset to defaults
    await config.param.reload();

    expect(await config.param.get()).toEqual({ items: [{ x: 0, y: 0 }] });

    // A new version should be auto-created
    const history = await provider.getHistory("migrate.reset.defaults");
    expect(history.length).toBe(2);
    expect(history[0].changeDescription).toContain("reset to defaults");
  });

  it("should use migrate function when provided", async () => {
    const schema = z.object({
      name: z.text(),
      age: z.number(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.function",
        schema,
        default: { name: "default", age: 0 },
        migrate: (old: unknown) => {
          const prev = old as Record<string, unknown>;
          return {
            // Test fixture: the body is a string the test just wrote.
            // oxlint-disable-next-line typescript/no-base-to-string
            name: String(prev.firstName ?? "unknown"),
            age: 30,
          };
        },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Seed database with old-format value, different schema hash
    await provider.save("migrate.function", { firstName: "jack" }, "old-hash");

    // Reload — migrate function should transform the value
    await config.param.reload();

    expect(await config.param.get()).toEqual({ name: "jack", age: 30 });

    // A new version should be auto-created
    const history = await provider.getHistory("migrate.function");
    expect(history.length).toBe(2);
  });

  it("should fall through to merge when migrate returns invalid value", async () => {
    const schema = z.object({
      name: z.text(),
      age: z.number(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.fallthrough.merge",
        schema,
        default: { name: "default", age: 42 },
        migrate: (_old: unknown) => {
          // Returns invalid value (missing required "age")
          return { name: "migrated" } as any;
        },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Seed database with value missing "age", different schema hash
    await provider.save(
      "migrate.fallthrough.merge",
      { name: "jack" },
      "old-hash",
    );

    // Reload — migrate returns invalid, falls through to merge with defaults
    await config.param.reload();

    expect(await config.param.get()).toEqual({ name: "jack", age: 42 });
  });

  it("should not migrate when schema hash matches", async () => {
    const schema = z.object({
      name: z.text(),
      age: z.number(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.hash.match",
        schema,
        default: { name: "default", age: 0 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Get the actual schema hash the provider calculated
    const providerAny = provider as any;
    const schemaHash = providerAny.schemaHashes.get("migrate.hash.match");

    // Seed database with the SAME schema hash — no migration needed
    await provider.save(
      "migrate.hash.match",
      { name: "jack", age: 99 },
      schemaHash,
    );

    // Reload — hash matches, no migration
    await config.param.reload();

    expect(await config.param.get()).toEqual({ name: "jack", age: 99 });

    // No new version created
    const history = await provider.getHistory("migrate.hash.match");
    expect(history.length).toBe(1);
  });

  it("should handle type change by resetting to defaults", async () => {
    const schema = z.object({
      name: z.number(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.type.change",
        schema,
        default: { name: 42 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Seed database with wrong type (string instead of number), different hash
    await provider.save("migrate.type.change", { name: "jack" }, "old-hash");

    // Reload — merge produces { name: "jack" } which is still invalid (wrong type)
    // Falls to default
    await config.param.reload();

    expect(await config.param.get()).toEqual({ name: 42 });

    const history = await provider.getHistory("migrate.type.change");
    expect(history.length).toBe(2);
    expect(history[0].changeDescription).toContain("reset to defaults");
  });

  it("should handle removed fields gracefully", async () => {
    const schema = z.object({
      name: z.text(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.removed.fields",
        schema,
        default: { name: "default" },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Seed database with extra fields that no longer exist in schema
    await provider.save(
      "migrate.removed.fields",
      { name: "jack", age: 30 },
      "old-hash",
    );

    // Reload — value should still work, "name" is present and valid
    await config.param.reload();

    const value = await config.param.get();
    expect((value as any).name).toBe("jack");
  });

  it("should not migrate when there is no DB value", async () => {
    const schema = z.object({
      name: z.text(),
      age: z.number(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.no.db.value",
        schema,
        default: { name: "default", age: 0 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    // No seeding — no DB value exists
    await config.param.reload();

    // Should use default
    expect(await config.param.get()).toEqual({ name: "default", age: 0 });
  });

  it("should handle migrate function that throws", async () => {
    const schema = z.object({
      name: z.text(),
      age: z.number(),
    });

    class AppConfig {
      param = $parameter({
        name: "migrate.throws",
        schema,
        default: { name: "default", age: 0 },
        migrate: (_old: unknown) => {
          throw new Error("migration failed");
        },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Seed database with value missing "age", different schema hash
    await provider.save("migrate.throws", { name: "jack" }, "old-hash");

    // Reload — migrate throws, falls through to merge with defaults
    await config.param.reload();

    expect(await config.param.get()).toEqual({ name: "jack", age: 0 });
  });

  it("should notify subscribers after auto-migration", async () => {
    const schema = z.object({
      name: z.text(),
      age: z.number(),
    });

    class Config {
      param = $parameter({
        name: "migrate.notify.sub",
        schema,
        default: { name: "default", age: 0 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(Config);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const config = alepha.inject(Config);

    // First, set a valid value so cachedCurrent has a previous value
    await config.param.set({ name: "jack", age: 30 });

    // Subscribe to changes
    const received: unknown[] = [];
    config.param.sub((v) => received.push(v));

    // Now save a value with old schema hash to trigger migration
    // Reset migrationChecked to allow re-migration. The value caches are now
    // keyed `${org}:${name}` — no org atom in this test → the `~global` org.
    (provider as any).migrationChecked.delete("~global:migrate.notify.sub");
    await provider.save(
      "migrate.notify.sub",
      { name: "alice" },
      "old-hash-notify",
    );

    // Reload triggers migration (merge adds default age)
    await config.param.reload();

    // Subscriber should have been notified with the migrated value
    expect(received.length).toBeGreaterThanOrEqual(1);
    const lastReceived = received[received.length - 1] as any;
    expect(lastReceived.name).toBe("alice");
    expect(lastReceived.age).toBe(0);
  });

  it("should handle completely new shape by resetting to defaults", async () => {
    const schema = z.object({
      width: z.number(),
      height: z.number(),
    });

    class Config {
      param = $parameter({
        name: "migrate.new.shape",
        schema,
        default: { width: 100, height: 200 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(Config);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    await provider.save(
      "migrate.new.shape",
      { color: "red", opacity: 0.5 },
      "old-hash",
    );

    const config = alepha.inject(Config);
    await config.param.reload();

    // Old shape has no overlapping fields — merge produces { width: 100, height: 200, color: "red", opacity: 0.5 }
    // After pickSchemaKeys: { width: 100, height: 200 } — which is valid! This is the merge path.
    // OR: merge invalid -> falls to defaults. Either way, result should have width/height.
    const value = await config.param.get();
    expect(value).toEqual({ width: 100, height: 200 });
  });

  it("should only migrate once per lifecycle in Node.js", async () => {
    const schema = z.object({
      name: z.text(),
      count: z.number(),
    });

    class Config {
      param = $parameter({
        name: "migrate.once",
        schema,
        default: { name: "default", count: 0 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(Config);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const config = alepha.inject(Config);

    // Save with old hash to trigger migration
    await provider.save("migrate.once", { name: "v1" }, "old-hash-once");

    // First reload triggers migration
    await config.param.reload();
    expect(await config.param.get()).toEqual({ name: "v1", count: 0 });

    const historyAfterFirst = await provider.getHistory("migrate.once");
    const versionCountAfterFirst = historyAfterFirst.length;

    // Save another value with old hash
    await provider.save("migrate.once", { name: "v2" }, "old-hash-once-2");

    // Second reload should NOT trigger migration (migrationChecked = true)
    await config.param.reload();

    // Value should be the raw DB value (v2 without count), since migration is skipped
    // The loaded value from DB is { name: "v2" } which becomes cachedCurrent
    const historyAfterSecond = await provider.getHistory("migrate.once");
    // No new migration version should have been created
    expect(historyAfterSecond.length).toBe(versionCountAfterFirst + 1); // only the provider.save we just did
  });
});

describe("getParameterNames (distinct query)", () => {
  it("should return unique names even with multiple versions", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    // Create multiple versions of the same parameter
    await provider.save("distinct.alpha", { a: 1 }, "h1");
    await provider.save("distinct.alpha", { a: 2 }, "h1");
    await provider.save("distinct.alpha", { a: 3 }, "h1");
    await provider.save("distinct.beta", { b: 1 }, "h2");

    const names = await provider.getParameterNames();

    // Should deduplicate — "distinct.alpha" appears once despite 3 versions
    const alphaCount = names.filter((n) => n === "distinct.alpha").length;
    expect(alphaCount).toBe(1);
    expect(names).toContain("distinct.alpha");
    expect(names).toContain("distinct.beta");
  });

  it("should return names in sorted order", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("sorted.charlie", { c: 1 }, "h");
    await provider.save("sorted.alpha", { a: 1 }, "h");
    await provider.save("sorted.bravo", { b: 1 }, "h");

    const names = await provider.getParameterNames();
    const relevant = names.filter((n) => n.startsWith("sorted."));

    expect(relevant).toEqual([
      "sorted.alpha",
      "sorted.bravo",
      "sorted.charlie",
    ]);
  });
});

describe("getVersion (direct lookup)", () => {
  it("should return a specific version without loading all history", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("version.lookup", { v: 1 }, "h");
    await provider.save("version.lookup", { v: 2 }, "h");
    await provider.save("version.lookup", { v: 3 }, "h");

    const v2 = await provider.getVersion("version.lookup", 2);
    expect(v2).not.toBeNull();
    expect(v2!.version).toBe(2);
    expect(v2!.content).toEqual({ v: 2 });
  });

  it("should return null for non-existent version", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("version.missing", { v: 1 }, "h");

    const missing = await provider.getVersion("version.missing", 99);
    expect(missing).toBeNull();
  });

  it("should allow calculating status for a single version", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("version.status", { v: 1 }, "h");
    await provider.save("version.status", { v: 2 }, "h");

    const v1 = await provider.getVersion("version.status", 1);
    const [withStatus] = provider.calculateStatuses([v1!]);

    // A single past version in isolation is both the latest activated and only one
    expect(withStatus.status).toBe("current");
    expect(withStatus.version).toBe(1);
  });
});

describe("save (status calculation without re-fetch)", () => {
  it("should return correct status for immediate save", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    const v1 = await provider.save("save.status.imm", { v: 1 }, "h");
    expect(v1.status).toBe("current");

    const v2 = await provider.save("save.status.imm", { v: 2 }, "h");
    expect(v2.status).toBe("current");
  });

  it("should return correct status for scheduled save", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const dateTime = alepha.inject(DateTimeProvider);

    // Create current version
    const v1 = await provider.save("save.status.sched", { v: 1 }, "h");
    expect(v1.status).toBe("current");

    // Create future version
    const futureDate = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    );
    const v2 = await provider.save("save.status.sched", { v: 2 }, "h", {
      activationDate: futureDate,
    });
    expect(v2.status).toBe("next");
  });

  it("should mark older versions as expired after new immediate save", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("save.status.expired", { v: 1 }, "h");
    await provider.save("save.status.expired", { v: 2 }, "h");
    const v3 = await provider.save("save.status.expired", { v: 3 }, "h");

    // v3 should be current
    expect(v3.status).toBe("current");

    // Verify via full history
    const history = await provider.getHistory("save.status.expired");
    const withStatuses = provider.calculateStatuses(history);
    expect(withStatuses.find((v) => v.version === 1)?.status).toBe("expired");
    expect(withStatuses.find((v) => v.version === 2)?.status).toBe("expired");
    expect(withStatuses.find((v) => v.version === 3)?.status).toBe("current");
  });

  it("should resolve empty schema hash from registered primitive", async () => {
    class AppConfig {
      features = $parameter({
        name: "save.hash.resolve",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    // Save with empty schema hash (simulates admin UI)
    const result = await provider.save(
      "save.hash.resolve",
      { enableBeta: true, maxUploadSize: 100 },
      "",
    );

    // Should have resolved the hash from the registered primitive
    expect(result.schemaHash).not.toBe("");

    // Save another version — should NOT log a schema migration since hash matches
    const v2 = await provider.save(
      "save.hash.resolve",
      { enableBeta: false, maxUploadSize: 200 },
      "",
    );
    expect(v2.migrationLog).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 1. rollback() error path
// ---------------------------------------------------------------------------

describe("rollback error path", () => {
  it("should throw AlephaError when rolling back to non-existent version", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("rollback.err", { v: 1 }, "h");

    await expect(provider.rollback("rollback.err", 99)).rejects.toThrowError(
      /Parameter version not found: rollback\.err@99/,
    );
  });

  it("should throw AlephaError when rolling back a parameter that does not exist", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await expect(
      provider.rollback("nonexistent.param", 1),
    ).rejects.toThrowError(/Parameter version not found/);
  });
});

// ---------------------------------------------------------------------------
// 2. getCurrentWithDefault()
// ---------------------------------------------------------------------------

describe("getCurrentWithDefault", () => {
  it("should return nulls for unregistered parameter", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const result = await provider.getCurrentWithDefault("unregistered.param");

    expect(result.current).toBeNull();
    expect(result.next).toBeNull();
    expect(result.defaultValue).toBeNull();
    expect(result.currentValue).toBeNull();
    expect(result.schema).toBeNull();
  });

  it("should lazy-seed v1 from defaults when primitive registered but no DB value", async () => {
    class AppConfig {
      features = $parameter({
        name: "gwd.default.only",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const result = await provider.getCurrentWithDefault("gwd.default.only");

    // Auto-seed: getCurrentWithDefault materializes v1 from the compiled
    // defaults when nothing is in the DB yet, so the admin UI always has a
    // concrete current row to edit / roll back / compare against.
    expect(result.current).not.toBeNull();
    expect(result.current!.version).toBe(1);
    expect(result.current!.status).toBe("current");
    expect(result.current!.content).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });
    expect(result.current!.changeDescription).toBe(
      "Auto-seeded from compiled defaults",
    );
    expect(result.next).toBeNull();
    expect(result.defaultValue).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });
    expect(result.currentValue).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });
    expect(result.schema).not.toBeNull();

    // Idempotent: a second call returns the same row without re-creating.
    const second = await provider.getCurrentWithDefault("gwd.default.only");
    expect(second.current!.id).toBe(result.current!.id);
    expect(second.current!.version).toBe(1);
  });

  it("should return current, next, and defaults when all exist", async () => {
    class AppConfig {
      features = $parameter({
        name: "gwd.full",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);
    const dateTime = alepha.inject(DateTimeProvider);

    // Set current value
    await config.features.set({ enableBeta: true, maxUploadSize: 100 });

    // Schedule future value
    const futureDate = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    );
    await config.features.set(
      { enableBeta: false, maxUploadSize: 999 },
      { activationDate: futureDate },
    );

    // Reload to pick up the next version in cache
    await config.features.reload();

    const result = await provider.getCurrentWithDefault("gwd.full");

    expect(result.current).not.toBeNull();
    expect(result.current!.status).toBe("current");
    expect(result.current!.content).toEqual({
      enableBeta: true,
      maxUploadSize: 100,
    });
    expect(result.next).not.toBeNull();
    expect(result.next!.status).toBe("next");
    expect(result.next!.content).toEqual({
      enableBeta: false,
      maxUploadSize: 999,
    });
    expect(result.defaultValue).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });
    expect(result.schema).not.toBeNull();
  });

  it("should return the schema as JSON Schema, not a raw ZodObject", async () => {
    // Regression: the parameter's `schema` is a live `ZodObject`. It must be
    // serialized to JSON Schema before transport — otherwise the action's
    // `schema: z.json()` response validation rejects it ("expected record,
    // received ZodObject at /schema"), 500-ing the admin Parameters UI when an
    // item is opened. The UI rebuilds its form by round-tripping the value back
    // through `jsonSchemaToZod` (the inverse of `z.toJSONSchema`).
    class AppConfig {
      features = $parameter({
        name: "gwd.schema.json",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const result = await provider.getCurrentWithDefault("gwd.schema.json");

    // A plain JSON-Schema record describing the parameter shape — never the
    // Zod instance (which would have `_zod`/`def`, not `type`/`properties`).
    expect(z.schema.isObject(result.schema as never)).toBe(false);
    expect((result.schema as { type?: string }).type).toBe("object");
    expect(
      Object.keys((result.schema as { properties?: object }).properties ?? {}),
    ).toEqual(expect.arrayContaining(["enableBeta", "maxUploadSize"]));

    // Round-trips back to a working Zod schema for the admin form.
    const rebuilt = jsonSchemaToZod(result.schema);
    expect(
      rebuilt.safeParse({ enableBeta: true, maxUploadSize: 42 }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. getCurrentValue()
// ---------------------------------------------------------------------------

describe("getCurrentValue", () => {
  it("should return null for unregistered parameter", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    expect(provider.getCurrentValue("unregistered.param")).toBeNull();
  });

  it("should return default value with isDefault=true when no DB value", async () => {
    class AppConfig {
      features = $parameter({
        name: "gcv.default",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const result = provider.getCurrentValue("gcv.default");

    expect(result).not.toBeNull();
    expect(result!.isDefault).toBe(true);
    expect(result!.content).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });
  });

  it("should return cached value with isDefault=false after set", async () => {
    class AppConfig {
      features = $parameter({
        name: "gcv.cached",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    await config.features.set({ enableBeta: true, maxUploadSize: 42 });

    const result = provider.getCurrentValue("gcv.cached");
    expect(result).not.toBeNull();
    expect(result!.isDefault).toBe(false);
    expect(result!.content).toEqual({ enableBeta: true, maxUploadSize: 42 });
  });
});

// ---------------------------------------------------------------------------
// 4. activateNow controller logic (tested via provider since controller
//    needs HTTP layer — we test the equivalent logic directly)
// ---------------------------------------------------------------------------

describe("activateNow logic", () => {
  it("should return current version as-is when already current", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("activate.current", { v: 1 }, "h");
    await provider.save("activate.current", { v: 2 }, "h");

    const history = await provider.getHistory("activate.current");
    const withStatuses = provider.calculateStatuses(history);
    const current = withStatuses.find((v) => v.status === "current")!;

    // Already current — no new version needed
    expect(current.version).toBe(2);
    expect(current.status).toBe("current");
  });

  it("should reject activating an expired version", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("activate.expired", { v: 1 }, "h");
    await provider.save("activate.expired", { v: 2 }, "h");

    const history = await provider.getHistory("activate.expired");
    const withStatuses = provider.calculateStatuses(history);
    const expired = withStatuses.find((v) => v.status === "expired")!;

    expect(expired.version).toBe(1);
    expect(expired.status).toBe("expired");
    // Controller would throw AlephaError("Cannot activate an expired version...")
  });

  it("should activate a future version by creating a new immediate version", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const dateTime = alepha.inject(DateTimeProvider);

    // Current version
    await provider.save("activate.future", { v: 1 }, "h");

    // Future version
    const futureDate = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    );
    await provider.save("activate.future", { v: 2 }, "h", {
      activationDate: futureDate,
    });

    // Find the future/next version
    const history = await provider.getHistory("activate.future");
    const withStatuses = provider.calculateStatuses(history);
    const next = withStatuses.find((v) => v.status === "next")!;

    expect(next.version).toBe(2);
    expect(next.content).toEqual({ v: 2 });

    // Activate it now (same as what the controller does)
    const activated = await provider.save(
      "activate.future",
      next.content,
      next.schemaHash,
      {
        changeDescription: `Early activation of version ${next.version}`,
      },
    );

    expect(activated.status).toBe("current");
    expect(activated.content).toEqual({ v: 2 });

    // Should have created version 3
    const updatedHistory = await provider.getHistory("activate.future");
    expect(updatedHistory.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 5. set() with scheduled activation — cache and subscriber behavior
// ---------------------------------------------------------------------------

describe("set with scheduled activation", () => {
  it("should not notify subscribers when scheduling a future value", async () => {
    class AppConfig {
      features = $parameter({
        name: "set.sched.nosub",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const dateTime = alepha.inject(DateTimeProvider);

    // Set an initial current value
    await config.features.set({ enableBeta: false, maxUploadSize: 100 });

    const received: unknown[] = [];
    config.features.sub((v) => received.push(v));

    // Schedule a future value — should NOT notify
    const futureDate = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    );
    await config.features.set(
      { enableBeta: true, maxUploadSize: 999 },
      { activationDate: futureDate },
    );

    expect(received.length).toBe(0);

    // Current value should still be the old one
    expect(await config.features.get()).toEqual({
      enableBeta: false,
      maxUploadSize: 100,
    });
  });

  it("should update cachedNext when scheduling a future value via set()", async () => {
    class AppConfig {
      features = $parameter({
        name: "set.sched.cache",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);
    const dateTime = alepha.inject(DateTimeProvider);

    await config.features.set({ enableBeta: false, maxUploadSize: 100 });

    const futureDate = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    );
    await config.features.set(
      { enableBeta: true, maxUploadSize: 999 },
      { activationDate: futureDate },
    );

    // cachedNext should be populated
    const providerAny = provider as any;
    // Value caches are keyed `${org}:${name}`; no org atom here → `~global`.
    const cachedNext = providerAny.cachedNext.get("~global:set.sched.cache");
    expect(cachedNext).not.toBeUndefined();
    expect(cachedNext.content).toEqual({
      enableBeta: true,
      maxUploadSize: 999,
    });
  });
});

// ---------------------------------------------------------------------------
// 6. buildTree edge cases
// ---------------------------------------------------------------------------

describe("buildTree edge cases", () => {
  it("should handle single-segment name (no dots)", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("logging", { level: "info" }, "h");

    const tree = await provider.getParameterTree();
    const logging = tree.find((n) => n.name === "logging");

    expect(logging).toBeDefined();
    expect(logging!.isLeaf).toBe(true);
    expect(logging!.path).toBe("logging");
    expect(logging!.children.length).toBe(0);
  });

  it("should handle name that is both a folder and a leaf", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    // "app.features" is a leaf, "app.features.flags" makes "features" also a folder
    await provider.save("app.features", { enabled: true }, "h1");
    await provider.save("app.features.flags", { beta: true }, "h2");

    const tree = await provider.getParameterTree();
    const app = tree.find((n) => n.name === "app");
    expect(app).toBeDefined();

    const features = app!.children.find((n) => n.name === "features");
    expect(features).toBeDefined();
    // Should be marked as leaf (since "app.features" exists as a parameter)
    expect(features!.isLeaf).toBe(true);
    // And also have children (since "app.features.flags" exists)
    expect(features!.children.length).toBe(1);
    expect(features!.children[0].name).toBe("flags");
  });

  it("should handle deeply nested names", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("a.b.c.d.e", { deep: true }, "h");

    const tree = await provider.getParameterTree();
    const a = tree.find((n) => n.name === "a");
    expect(a).toBeDefined();
    expect(a!.isLeaf).toBe(false);

    const b = a!.children[0];
    expect(b.name).toBe("b");
    expect(b.isLeaf).toBe(false);

    const e = b.children[0].children[0].children[0];
    expect(e.name).toBe("e");
    expect(e.isLeaf).toBe(true);
    expect(e.path).toBe("a.b.c.d.e");
  });
});

// ---------------------------------------------------------------------------
// 7. loadCurrentAndNext tie-breaking (same-millisecond activationDate)
// ---------------------------------------------------------------------------

describe("loadCurrentAndNext tie-breaking", () => {
  it("should pick highest version when multiple versions have the same activationDate", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    // Create two immediate versions — they will have the same (or very close) activationDate
    await provider.save("tie.break", { v: 1 }, "h");
    await provider.save("tie.break", { v: 2 }, "h");

    const { current } = await provider.loadCurrentAndNext("tie.break");

    expect(current).not.toBeNull();
    // Should pick version 2 (highest version in same-millisecond tie)
    expect(current!.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. doLoad subscriber notification on value change
// ---------------------------------------------------------------------------

describe("doLoad subscriber notification", () => {
  it("should notify subscribers when DB value changes on reload", async () => {
    class AppConfig {
      features = $parameter({
        name: "doload.notify",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    // Set initial value so cachedCurrent is populated
    await config.features.set({ enableBeta: false, maxUploadSize: 100 });

    const received: unknown[] = [];
    config.features.sub((v) => received.push(v));

    // Externally save a different value (simulating another instance)
    await provider.save(
      "doload.notify",
      { enableBeta: true, maxUploadSize: 999 },
      "ext-hash",
    );

    // Reload — should detect change and notify
    await config.features.reload();

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ enableBeta: true, maxUploadSize: 999 });
  });

  it("should NOT notify subscribers when DB value is the same on reload", async () => {
    class AppConfig {
      features = $parameter({
        name: "doload.nonotify",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    // Set value
    await config.features.set({ enableBeta: true, maxUploadSize: 42 });

    const received: unknown[] = [];
    config.features.sub((v) => received.push(v));

    // Reload — same value, should NOT notify
    await config.features.reload();

    expect(received.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. reloadNextInBackground error resilience
// ---------------------------------------------------------------------------

describe("reloadNextInBackground", () => {
  it("should not throw when next promotion triggers background reload", async () => {
    class AppConfig {
      features = $parameter({
        name: "bgreload.resilience",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const dateTime = alepha.inject(DateTimeProvider);

    // Set current + scheduled
    await config.features.set({ enableBeta: false, maxUploadSize: 100 });

    const futureDate = new Date(
      dateTime.now().toDate().getTime() + 60 * 60 * 1000,
    );
    await config.features.set(
      { enableBeta: true, maxUploadSize: 999 },
      { activationDate: futureDate },
    );

    await config.features.reload();

    // Travel past activation — get() triggers promotion + background reload
    await dateTime.travel(2, "hours");

    // This should not throw even though background reload runs
    const value = await config.features.get();
    expect(value).toEqual({ enableBeta: true, maxUploadSize: 999 });

    // Wait a tick to let the background promise settle
    await new Promise((r) => setTimeout(r, 50));
  });
});

// ---------------------------------------------------------------------------
// 10. ParameterTreeNode schema uses z.any() for children
// ---------------------------------------------------------------------------

describe("ParameterTreeNode children structure", () => {
  it("should produce correctly typed children at runtime despite z.any() schema", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("typed.tree.a.b", { v: 1 }, "h");
    await provider.save("typed.tree.a.c", { v: 2 }, "h");

    const tree = await provider.getParameterTree();
    const typed = tree.find((n) => n.name === "typed");

    expect(typed).toBeDefined();
    expect(typed!.children.length).toBe(1); // "tree"

    const treeNode = typed!.children[0];
    expect(treeNode.name).toBe("tree");
    expect(treeNode.children.length).toBe(1); // "a"

    const aNode = treeNode.children[0];
    expect(aNode.name).toBe("a");
    expect(aNode.children.length).toBe(2); // "b", "c"

    // Verify children have the correct shape (name, path, isLeaf, children)
    for (const child of aNode.children) {
      expect(child).toHaveProperty("name");
      expect(child).toHaveProperty("path");
      expect(child).toHaveProperty("isLeaf");
      expect(child).toHaveProperty("children");
      expect(child.isLeaf).toBe(true);
      expect(child.children).toEqual([]);
    }

    expect(aNode.children.map((c: any) => c.name).sort()).toEqual(["b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// Content validation in save()
// ---------------------------------------------------------------------------

describe("save validation", () => {
  it("should reject invalid content when schema hash matches", async () => {
    class AppConfig {
      features = $parameter({
        name: "validate.reject",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const schemaHash = (provider as any).schemaHashes.get("validate.reject");

    // Invalid: maxUploadSize should be number, not string
    await expect(
      provider.save(
        "validate.reject",
        { enableBeta: true, maxUploadSize: "not-a-number" } as any,
        schemaHash,
      ),
    ).rejects.toThrow();
  });

  it("should accept valid content when schema hash matches", async () => {
    class AppConfig {
      features = $parameter({
        name: "validate.accept",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);
    const schemaHash = (provider as any).schemaHashes.get("validate.accept");

    const result = await provider.save(
      "validate.accept",
      { enableBeta: true, maxUploadSize: 999 },
      schemaHash,
    );

    expect(result.content).toEqual({ enableBeta: true, maxUploadSize: 999 });
  });

  it("should skip validation when schema hash differs (migration seed)", async () => {
    class AppConfig {
      features = $parameter({
        name: "validate.skip",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    // Save with mismatched hash — should NOT validate against current schema
    const result = await provider.save(
      "validate.skip",
      { totally: "different", shape: 42 } as any,
      "old-hash",
    );

    expect(result.content).toEqual({ totally: "different", shape: 42 });
  });
});

// ---------------------------------------------------------------------------
// $parameter.name fallback
// ---------------------------------------------------------------------------

describe("$parameter.name fallback", () => {
  it("should use ClassName.propertyKey when name option is omitted", async () => {
    class MySettings {
      theme = $parameter({
        schema: z.object({ dark: z.boolean() }),
        default: { dark: false },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(MySettings);
    await alepha.start();

    const settings = alepha.inject(MySettings);
    expect(settings.theme.name).toBe("MySettings.theme");
  });

  it("should use explicit name when provided", async () => {
    class MySettings {
      theme = $parameter({
        name: "app.ui.theme",
        schema: z.object({ dark: z.boolean() }),
        default: { dark: false },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(MySettings);
    await alepha.start();

    const settings = alepha.inject(MySettings);
    expect(settings.theme.name).toBe("app.ui.theme");
  });
});

// ---------------------------------------------------------------------------
// delete()
// ---------------------------------------------------------------------------

describe("delete", () => {
  it("should delete all versions and clear cache", async () => {
    class AppConfig {
      features = $parameter({
        name: "delete.test",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const provider = alepha.inject(ParameterProvider);

    await config.features.set({ enableBeta: true, maxUploadSize: 100 });
    await config.features.set({ enableBeta: false, maxUploadSize: 200 });

    const historyBefore = await provider.getHistory("delete.test");
    expect(historyBefore.length).toBe(2);

    await config.features.delete();

    // All versions gone
    const historyAfter = await provider.getHistory("delete.test");
    expect(historyAfter.length).toBe(0);

    // Cache cleared — falls back to default
    expect(await config.features.get()).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });
    expect(config.features.isUsingDefault).toBe(true);
  });

  it("should be a no-op for non-existent parameter", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    // Should not throw
    await provider.delete("nonexistent.param");
  });
});

// ---------------------------------------------------------------------------
// getHistory pagination
// ---------------------------------------------------------------------------

describe("getHistory pagination", () => {
  it("should respect limit and offset", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    for (let i = 1; i <= 5; i++) {
      await provider.save("paginate.test", { v: i }, "h");
    }

    // Get first 2 (versions 5, 4 — desc order)
    const page1 = await provider.getHistory("paginate.test", {
      limit: 2,
    });
    expect(page1.length).toBe(2);
    expect(page1[0].version).toBe(5);
    expect(page1[1].version).toBe(4);

    // Get next 2 (versions 3, 2)
    const page2 = await provider.getHistory("paginate.test", {
      limit: 2,
      offset: 2,
    });
    expect(page2.length).toBe(2);
    expect(page2[0].version).toBe(3);
    expect(page2[1].version).toBe(2);
  });

  it("should return all when no limit specified", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    await provider.save("paginate.all", { v: 1 }, "h");
    await provider.save("paginate.all", { v: 2 }, "h");
    await provider.save("paginate.all", { v: 3 }, "h");

    const all = await provider.getHistory("paginate.all");
    expect(all.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getVersion on primitive
// ---------------------------------------------------------------------------

describe("$parameter.getVersion", () => {
  it("should return a specific version via the primitive", async () => {
    class AppConfig {
      features = $parameter({
        name: "prim.getversion",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    await config.features.set({ enableBeta: true, maxUploadSize: 1 });
    await config.features.set({ enableBeta: false, maxUploadSize: 2 });

    const v1 = await config.features.getVersion(1);
    expect(v1).not.toBeNull();
    expect(v1!.content).toEqual({ enableBeta: true, maxUploadSize: 1 });

    const missing = await config.features.getVersion(99);
    expect(missing).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe("tags", () => {
  it("should store and retrieve tags on parameter versions", async () => {
    class AppConfig {
      features = $parameter({
        name: "tags.test",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    await config.features.set(
      { enableBeta: true, maxUploadSize: 100 },
      { tags: ["feature-flag", "beta"] },
    );

    const history = await config.features.getHistory();
    expect(history[0].tags).toEqual(["feature-flag", "beta"]);
  });
});

// ---------------------------------------------------------------------------
// Set idempotency
// ---------------------------------------------------------------------------

describe("set idempotency", () => {
  it("should not notify subscribers when setting the same value", async () => {
    class AppConfig {
      features = $parameter({
        name: "idempotent.test",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    await config.features.set({ enableBeta: true, maxUploadSize: 100 });

    const received: unknown[] = [];
    config.features.sub((v) => received.push(v));

    // Set the exact same value again
    await config.features.set({ enableBeta: true, maxUploadSize: 100 });

    expect(received.length).toBe(0);
  });
});

describe("$parameter multi-tenant isolation", () => {
  it("partitions stored values + caches by the active org (no cross-tenant read/write)", async () => {
    class AppConfig {
      settings = $parameter({
        name: "club.settings",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 1 },
      });
    }

    const alepha = Alepha.create().with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const orgA = "00000000-0000-0000-0000-0000000000aa";
    const orgB = "00000000-0000-0000-0000-0000000000bb";

    // Org A writes its own value.
    alepha.store.set(currentTenantAtom, { id: orgA });
    await config.settings.set({ enableBeta: true, maxUploadSize: 10 });
    expect(await config.settings.get()).toEqual({
      enableBeta: true,
      maxUploadSize: 10,
    });

    // Org B sees ONLY its default — never org A's value (the bug this fixes).
    alepha.store.set(currentTenantAtom, { id: orgB });
    expect(await config.settings.get()).toEqual({
      enableBeta: false,
      maxUploadSize: 1,
    });

    // Org B writes its own; org A is untouched.
    await config.settings.set({ enableBeta: false, maxUploadSize: 99 });
    expect(await config.settings.get()).toEqual({
      enableBeta: false,
      maxUploadSize: 99,
    });

    alepha.store.set(currentTenantAtom, { id: orgA });
    expect(await config.settings.get()).toEqual({
      enableBeta: true,
      maxUploadSize: 10,
    });

    await alepha.stop();
  });

  it("revalidates a stale cache after PARAMETERS_CACHE_TTL_MS (cross-isolate write)", async () => {
    class AppConfig {
      flags = $parameter({
        name: "app.ttlRevalidation.flags",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 1 },
      });
    }

    // Writes a new version to the DB WITHOUT touching this instance's
    // in-memory cache — exactly what a `set()` handled by ANOTHER worker
    // isolate looks like from here (the sync topic rides the in-memory
    // queue, so it never crosses isolates).
    class TestableProvider extends ParameterProvider {
      writeBehindCache(name: string, value: Record<string, unknown>) {
        return this.save(name, value, this.schemaHashes.get(name) ?? "", {});
      }
    }

    // A generous TTL driven by `travel()` rather than a short one raced
    // against the wall clock. At 50ms the "still stale" assertion below
    // depended on three Postgres round-trips finishing inside 50ms, which a
    // loaded CI runner does not do — the cache expired early, `get()`
    // re-read, and the test failed claiming the TTL had not been honoured.
    const alepha = Alepha.create({
      env: { ...process.env, PARAMETERS_CACHE_TTL_MS: "60000" },
    });
    alepha.with({ provide: ParameterProvider, use: TestableProvider });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const time = alepha.inject(DateTimeProvider);
    const config = alepha.inject(AppConfig);
    await config.flags.set({ enableBeta: false, maxUploadSize: 1 });
    expect((await config.flags.get()).enableBeta).toBe(false);

    const provider = alepha.inject(ParameterProvider) as TestableProvider;
    await provider.writeBehindCache("app.ttlRevalidation.flags", {
      enableBeta: true,
      maxUploadSize: 2,
    });

    // Within the TTL the (stale) cache still serves.
    expect((await config.flags.get()).enableBeta).toBe(false);

    // Past the TTL, get() re-reads the DB and converges.
    await time.travel([2, "minutes"]);
    expect((await config.flags.get()).enableBeta).toBe(true);

    await alepha.stop();
  });

  it("keeps the historical never-revalidate behaviour when the TTL is 0", async () => {
    class AppConfig {
      flags = $parameter({
        name: "app.ttlZero.flags",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 1 },
      });
    }

    class TestableProvider extends ParameterProvider {
      writeBehindCache(name: string, value: Record<string, unknown>) {
        return this.save(name, value, this.schemaHashes.get(name) ?? "", {});
      }
    }

    const alepha = Alepha.create({
      env: { ...process.env, PARAMETERS_CACHE_TTL_MS: "0" },
    });
    alepha.with({ provide: ParameterProvider, use: TestableProvider });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    await config.flags.set({ enableBeta: false, maxUploadSize: 1 });

    const provider = alepha.inject(ParameterProvider) as TestableProvider;
    await provider.writeBehindCache("app.ttlZero.flags", {
      enableBeta: true,
      maxUploadSize: 2,
    });

    await new Promise((r) => setTimeout(r, 80));
    expect((await config.flags.get()).enableBeta).toBe(false);

    await alepha.stop();
  });
});

/**
 * Fails `loadCurrentAndNext` a configurable number of times so a transient
 * DB outage can be simulated.
 */
class FlakyParameterProvider extends ParameterProvider {
  public failuresLeft = 0;

  /**
   * Simulate a cold instance that has not loaded this parameter yet.
   */
  public forgetLoaded(name: string): void {
    this.loaded.delete(this.cacheKey(name));
  }

  public override async loadCurrentAndNext(
    ...args: Parameters<ParameterProvider["loadCurrentAndNext"]>
  ): Promise<any> {
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new Error("transient DB failure");
    }
    return super.loadCurrentAndNext(...args);
  }
}

describe("$parameter — load failure recovery", () => {
  it("recovers after a transient load failure instead of poisoning the cache", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.recovery",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with({ provide: ParameterProvider, use: FlakyParameterProvider })
      .with(AlephaApiParameters)
      .with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider) as FlakyParameterProvider;
    const app = alepha.inject(AppConfig);

    // A cold instance lazily loading the parameter hits a transient outage.
    provider.forgetLoaded("app.features.recovery");
    provider.failuresLeft = 1;
    await expect(app.features.get()).rejects.toThrow(/transient/);

    // That rejection must not be cached. `get()` only starts a load when no
    // promise is in flight, so a rejected one left in the map was re-awaited
    // by every subsequent call — the parameter never recovered short of a
    // process restart.
    const value = await app.features.get();
    expect(value).toEqual({ enableBeta: false, maxUploadSize: 10485760 });
  });
});

describe("$parameter — cross-instance delete", () => {
  it("publishes a sync notification when a parameter is deleted", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.deleted",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiParameters)
      .with(AppConfig);
    await alepha.start();

    const provider = alepha.inject(ParameterProvider);

    const seen: string[] = [];
    await provider.syncTopic.subscribe(async (message) => {
      seen.push(message.payload.name);
    });

    // The parameter must exist before we delete it; the schema hash is
    // resolved from the registered primitive when empty.
    await provider.save(
      "app.features.deleted",
      { enableBeta: true, maxUploadSize: 1 },
      "",
    );
    seen.length = 0;

    await provider.delete("app.features.deleted");

    // Without this, other instances keep serving the deleted value forever:
    // the Node default TTL is 0, so nothing ever revalidates. `save()`
    // already published; `delete()` did not.
    expect(seen).toContain("app.features.deleted");
  });
});

import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $parameter, AlephaApiParameters, ParameterStore } from "../index.ts";

const featureSchema = t.object({
  enableBeta: t.boolean(),
  maxUploadSize: t.number(),
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

    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    expect(config.features.current).toEqual({
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

    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    await config.features.set({
      enableBeta: true,
      maxUploadSize: 20971520,
    });

    expect(config.features.current).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });

    // Verify persisted to database
    const store = alepha.inject(ParameterStore);
    const history = await store.getHistory("app.features.flags");
    expect(history.length).toBe(1);
    expect(history[0].status).toBe("current");
    expect(history[0].content).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });
  });

  it("should load from database on start", async () => {
    // Use a single Alepha instance, seed data via store before registering parameter
    class AppConfig {
      features = $parameter({
        name: "app.features.load",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    // First, seed the database with a value different from default
    const store = alepha.inject(ParameterStore);
    await store.save(
      "app.features.load",
      { enableBeta: true, maxUploadSize: 5242880 },
      "test-hash",
    );

    // Manually reload the parameter primitive
    const config = alepha.inject(AppConfig);
    await config.features.reload();

    // Should have loaded from database, not default
    expect(config.features.current).toEqual({
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

    const alepha = Alepha.create();
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

    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    await config.features.set({ enableBeta: true, maxUploadSize: 100 });
    await config.features.set({ enableBeta: false, maxUploadSize: 200 });
    await config.features.set({ enableBeta: true, maxUploadSize: 300 });

    // Rollback to version 1
    await config.features.rollback(1);

    expect(config.features.current).toEqual({
      enableBeta: true,
      maxUploadSize: 100,
    });

    // Should have created a new version (4)
    const history = await config.features.getHistory();
    expect(history.length).toBe(4);
  });

  it("should get specific field value", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.field",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);

    expect(config.features.get("enableBeta")).toBe(false);
    expect(config.features.get("maxUploadSize")).toBe(10485760);
  });

  it("should support change description", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.description",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create();
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

    const alepha = Alepha.create();
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
});

describe("ParameterStore", () => {
  it("should build parameter tree from names", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ParameterStore);

    await store.save("app.features.flags", { enabled: true }, "hash1");
    await store.save("app.features.limits", { max: 100 }, "hash2");
    await store.save("app.pricing.tiers", { basic: 10 }, "hash3");
    await store.save("system.logging", { level: "info" }, "hash4");

    const tree = await store.getParameterTree();

    expect(tree.length).toBe(2); // app, system
    expect(tree[0].name).toBe("app");
    expect(tree[0].isLeaf).toBe(false);
    expect(tree[0].children.length).toBe(2); // features, pricing

    const features = tree[0].children.find((c) => c.name === "features");
    expect(features?.children.length).toBe(2); // flags, limits
  });

  it("should manage status transitions correctly", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ParameterStore);

    // Create first version (current)
    const v1 = await store.save("test.status.param", { value: 1 }, "hash");
    expect(v1.status).toBe("current");

    // Create second version (becomes current, first becomes expired)
    const v2 = await store.save("test.status.param", { value: 2 }, "hash");
    expect(v2.status).toBe("current");

    const history = await store.getHistory("test.status.param");
    const v1Updated = history.find((v) => v.version === 1);
    expect(v1Updated?.status).toBe("expired");
  });

  it("should get parameters by status", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ParameterStore);

    await store.save("status.a", { a: 1 }, "h1");
    await store.save("status.b", { b: 1 }, "h2");
    await store.save("status.a", { a: 2 }, "h1");

    const current = await store.getByStatus("current");
    const expired = await store.getByStatus("expired");

    expect(current.length).toBe(2);
    expect(expired.length).toBe(1);
  });

  it("should detect schema migration", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ParameterStore);

    await store.save("migration.param", { v: 1 }, "hash-v1");
    const v2 = await store.save(
      "migration.param",
      { v: 2, extra: true },
      "hash-v2",
    );

    expect(v2.migrationLog).toContain("Schema changed");
    expect(v2.migrationLog).toContain("hash-v1");
    expect(v2.migrationLog).toContain("hash-v2");
  });

  it("should store previous content for rollback", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ParameterStore);

    await store.save("previous.param", { old: true }, "hash");
    const v2 = await store.save("previous.param", { new: true }, "hash");

    expect(v2.previousContent).toEqual({ old: true });
  });

  it("should get all parameter names", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ParameterStore);

    await store.save("names.alpha", { a: 1 }, "h1");
    await store.save("names.beta", { b: 1 }, "h2");
    await store.save("names.alpha", { a: 2 }, "h1"); // Second version

    const names = await store.getParameterNames();

    expect(names).toContain("names.alpha");
    expect(names).toContain("names.beta");
  });
});

describe("Cross-instance sync", () => {
  it("should sync parameter changes between two Alepha instances sharing same db", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.sync",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    // Create first Alepha instance
    const alepha1 = Alepha.create();
    alepha1.with(AlephaApiParameters);
    alepha1.with(AppConfig);
    await alepha1.start();

    // Create second Alepha instance (shares same in-memory SQLite db in test env)
    const alepha2 = Alepha.create();
    alepha2.with(AlephaApiParameters);
    alepha2.with(AppConfig);
    await alepha2.start();

    const config1 = alepha1.inject(AppConfig);
    const config2 = alepha2.inject(AppConfig);
    const store1 = alepha1.inject(ParameterStore);

    // Both should start with default
    expect(config1.features.current).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });
    expect(config2.features.current).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });

    // Update parameter on instance 1
    await config1.features.set({
      enableBeta: true,
      maxUploadSize: 20971520,
    });

    // Instance 1 should have the new value
    expect(config1.features.current).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });

    // Instance 2 still has default (hasn't received sync yet)
    expect(config2.features.current).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });

    // Simulate instance 2 receiving sync message by calling updateFromSync
    // In production this would happen via the topic subscription
    await config2.features.updateFromSync({
      enableBeta: true,
      maxUploadSize: 20971520,
    });

    // Instance 2 should now have the synced value
    expect(config2.features.current).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });

    // Verify instance 1 persisted to its database
    const history = await store1.getHistory("app.features.sync");
    expect(history.length).toBeGreaterThanOrEqual(1);
    const current = history.find((v) => v.status === "current");
    expect(current?.content).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });
  });

  it("should update from sync without triggering infinite loop", async () => {
    class AppConfig {
      features = $parameter({
        name: "app.features.noloop",
        schema: featureSchema,
        default: { enableBeta: false, maxUploadSize: 10485760 },
      });
    }

    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const config = alepha.inject(AppConfig);
    const store = alepha.inject(ParameterStore);

    // Count how many saves happen
    let saveCount = 0;
    const originalSave = store.save.bind(store);
    store.save = async (...args) => {
      saveCount++;
      return originalSave(...args);
    };

    // Update from sync should NOT trigger a save (it's a sync, not a mutation)
    await config.features.updateFromSync({
      enableBeta: true,
      maxUploadSize: 5000,
    });

    // Should have zero saves because updateFromSync uses skipEvents
    expect(saveCount).toBe(0);

    // But the value should be updated in memory
    expect(config.features.current).toEqual({
      enableBeta: true,
      maxUploadSize: 5000,
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

    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    alepha.with(AppConfig);
    await alepha.start();

    const store = alepha.inject(ParameterStore);

    // Get the store's instanceId (it's protected but we can access it for testing)
    const storeAny = store as any;
    const selfInstanceId = storeAny.instanceId;

    // Simulate receiving a sync message from self (should be ignored)
    const selfPayload = {
      name: "app.features.selfignore",
      version: 1,
      content: { enableBeta: true, maxUploadSize: 999 },
      status: "current" as const,
      instanceId: selfInstanceId,
    };

    // Call the handler directly
    await storeAny.handleSyncMessage(selfPayload);

    // Value should NOT have changed (self-messages are ignored)
    const config = alepha.inject(AppConfig);
    expect(config.features.current).toEqual({
      enableBeta: false,
      maxUploadSize: 10485760,
    });

    // Simulate receiving a sync message from another instance (should be processed)
    const otherPayload = {
      name: "app.features.selfignore",
      version: 1,
      content: { enableBeta: true, maxUploadSize: 999 },
      status: "current" as const,
      instanceId: "other-instance-id",
    };

    await storeAny.handleSyncMessage(otherPayload);

    // Value should now be updated
    expect(config.features.current).toEqual({
      enableBeta: true,
      maxUploadSize: 999,
    });
  });
});

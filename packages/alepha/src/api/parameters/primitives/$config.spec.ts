import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $config, AlephaApiParameters, ConfigStore } from "../index.ts";

const featureSchema = t.object({
  enableBeta: t.boolean(),
  maxUploadSize: t.number(),
});

describe("$config", () => {
  it("should initialize with default value", async () => {
    class AppConfig {
      features = $config({
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

  it("should set and persist configuration", async () => {
    class AppConfig {
      features = $config({
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
    const store = alepha.inject(ConfigStore);
    const history = await store.getHistory("app.features.flags");
    expect(history.length).toBe(1);
    expect(history[0].status).toBe("current");
    expect(history[0].content).toEqual({
      enableBeta: true,
      maxUploadSize: 20971520,
    });
  });

  it("should load from database on start", async () => {
    // Use a single Alepha instance, seed data via store before registering config
    class AppConfig {
      features = $config({
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
    const store = alepha.inject(ConfigStore);
    await store.save(
      "app.features.load",
      { enableBeta: true, maxUploadSize: 5242880 },
      "test-hash",
    );

    // Manually reload the config primitive
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
      features = $config({
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
      features = $config({
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
      features = $config({
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
      features = $config({
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
      features = $config({
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

describe("ConfigStore", () => {
  it("should build config tree from names", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ConfigStore);

    await store.save("app.features.flags", { enabled: true }, "hash1");
    await store.save("app.features.limits", { max: 100 }, "hash2");
    await store.save("app.pricing.tiers", { basic: 10 }, "hash3");
    await store.save("system.logging", { level: "info" }, "hash4");

    const tree = await store.getConfigTree();

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

    const store = alepha.inject(ConfigStore);

    // Create first version (current)
    const v1 = await store.save("test.status.config", { value: 1 }, "hash");
    expect(v1.status).toBe("current");

    // Create second version (becomes current, first becomes expired)
    const v2 = await store.save("test.status.config", { value: 2 }, "hash");
    expect(v2.status).toBe("current");

    const history = await store.getHistory("test.status.config");
    const v1Updated = history.find((v) => v.version === 1);
    expect(v1Updated?.status).toBe("expired");
  });

  it("should get configs by status", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ConfigStore);

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

    const store = alepha.inject(ConfigStore);

    await store.save("migration.config", { v: 1 }, "hash-v1");
    const v2 = await store.save(
      "migration.config",
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

    const store = alepha.inject(ConfigStore);

    await store.save("previous.config", { old: true }, "hash");
    const v2 = await store.save("previous.config", { new: true }, "hash");

    expect(v2.previousContent).toEqual({ old: true });
  });

  it("should get all config names", async () => {
    const alepha = Alepha.create();
    alepha.with(AlephaApiParameters);
    await alepha.start();

    const store = alepha.inject(ConfigStore);

    await store.save("names.alpha", { a: 1 }, "h1");
    await store.save("names.beta", { b: 1 }, "h2");
    await store.save("names.alpha", { a: 2 }, "h1"); // Second version

    const names = await store.getConfigNames();

    expect(names).toContain("names.alpha");
    expect(names).toContain("names.beta");
  });
});

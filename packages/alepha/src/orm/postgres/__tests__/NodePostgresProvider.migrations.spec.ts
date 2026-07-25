import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { NodePostgresProvider } from "../providers/NodePostgresProvider.ts";

class TestPostgresProvider extends NodePostgresProvider {
  /**
   * In test mode `PostgresProvider` generates a throwaway schema per run, so
   * `schema` is never "public" — clear it to exercise the plain path.
   */
  public clearTestSchema(): void {
    this.schemaForTesting = undefined;
  }

  public testMigrationClientOptions() {
    return this.migrationClientOptions();
  }

  public testNeedsDedicatedMigrationClient(): boolean {
    return this.needsDedicatedMigrationClient();
  }
}

describe("NodePostgresProvider migrations", () => {
  const boot = (env: Record<string, string>) => {
    const alepha = Alepha.create({
      env: {
        DATABASE_URL: "postgres://user:pass@localhost:5432/app",
        ...env,
      },
    });
    return alepha.inject(TestPostgresProvider);
  };

  describe("search_path", () => {
    it("should run migrations on a single dedicated connection", async () => {
      // `SET search_path` followed by `migrate()` is two statements on a
      // POOL: postgres.js is free to hand the second one a different
      // connection, one that never saw the SET — so the migration creates its
      // tables in `public` while the app reads them from the configured
      // schema. Pinning the migration to `max: 1` makes the SET and the
      // migration provably the same session.
      const provider = boot({ POSTGRES_SCHEMA: "tenant" });

      expect(provider.testNeedsDedicatedMigrationClient()).toBe(true);
      expect(provider.testMigrationClientOptions().max).toBe(1);
    });

    it("should not open a dedicated client when the schema is public", async () => {
      // Nothing to SET, so nothing to race: the normal pool is fine and a
      // second client would just be waste on every boot.
      const provider = boot({});
      provider.clearTestSchema();

      expect(provider.testNeedsDedicatedMigrationClient()).toBe(false);
    });

    it("should keep the connection details of the configured database", async () => {
      // The dedicated client must reach the SAME database — an options object
      // rebuilt from scratch would quietly migrate somewhere else.
      const provider = boot({ POSTGRES_SCHEMA: "tenant" });

      const options = provider.testMigrationClientOptions();
      expect(options.host).toBe("localhost");
      expect(options.database).toBe("app");
      expect(options.user).toBe("user");
      expect(options.port).toBe(5432);
    });

    it("should ignore a configured pool size for the migration client", async () => {
      // POOL_MAX applies to the app's pool; the migration client is
      // deliberately one connection regardless.
      const provider = boot({ POSTGRES_SCHEMA: "tenant", POOL_MAX: "10" });

      expect(provider.testMigrationClientOptions().max).toBe(1);
    });
  });
});

import { Alepha } from "alepha";
import {
  bay,
  cloudflare,
  CloudflareAdapter,
  infraOptions,
} from "alepha/cli/infra-lib";
import { CliProvider } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { InfraCommand } from "../commands/infra.ts";

/**
 * `authenticate()` shells out to wrangler for login/version checks and hits
 * the real Cloudflare REST API for account resolution. None of that is
 * under test here  -  only that `infra db baseline mark` resolves the
 * right D1 database name (naming) and reaches
 * `D1MigrationsService.baseline` with the right arguments  -  so it is
 * stubbed to a no-op, same as a real `alepha deploy` would have already
 * authenticated in an earlier step.
 */
class FakeCloudflareAdapter extends CloudflareAdapter {
  public transport?: FakeD1Transport;

  public override async authenticate(): Promise<void> {}

  public override async d1Transport() {
    return this.transport as never;
  }
}

class TestInfraCommand extends InfraCommand {
  public readonly testBaselineMark = this.baselineMark;
}

/**
 * `D1MigrationsService` is used for real (not substituted): only its
 * transport is a fake, and it reads the container's memory filesystem. That
 * proves the whole chain (naming -> dbName -> the service -> the SQL posted to
 * the D1 query API) actually works end-to-end, not just that the right method
 * gets called.
 */
class FakeD1Transport {
  public readonly sql: string[] = [];
  public appliedNames: string[] = [];

  async resolveD1Id(name: string) {
    return `uuid-of-${name}`;
  }

  async d1Query(_databaseId: string, sql: string) {
    this.sql.push(sql);
    if (sql.includes("SELECT name FROM d1_migrations")) {
      return [{ results: this.appliedNames.map((name) => ({ name })) }];
    }
    return [];
  }
}

describe("InfraCommand", () => {
  describe("db baseline mark", () => {
    const create = async (
      config: Record<string, unknown> = {},
      migrationPaths: string[] = ["migrations/sqlite/0000_baseline.sql"],
    ) => {
      const alepha = Alepha.create()
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
        .with({ provide: CloudflareAdapter, use: FakeCloudflareAdapter });

      const fs = alepha.inject(MemoryFileSystemProvider);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestInfraCommand);

      const api = new FakeD1Transport();
      // The migrations sit in the container's memory filesystem, the one the
      // service reads; the TRANSPORT is the adapter's, because it carries the
      // credential (#288). So the fake goes on the adapter, not on the
      // service.
      for (const path of migrationPaths) {
        await fs.writeFile(`/project/${path}`, "");
      }
      alepha.inject(FakeCloudflareAdapter).transport = api;

      alepha.set(infraOptions, {
        name: "my-app",
        environments: { production: cloudflare() },
        ...config,
      } as any);

      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ name: "my-app" }),
      );

      const writes: string[] = [];
      const captureStdout = async (fn: () => Promise<void>) => {
        const original = process.stdout.write;
        process.stdout.write = ((chunk: string) => {
          writes.push(chunk);
          return true;
        }) as any;
        try {
          await fn();
        } finally {
          process.stdout.write = original;
        }
        return writes.join("");
      };

      return { alepha, fs, cli, cmd, api, captureStdout };
    };

    /**
     * `--reset` on `alepha infra db baseline mark` must actually reach
     * `D1MigrationsService.baseline`
     * (previously it was declared on core `alepha db baseline mark` and read
     * by nothing). Proven end-to-end: real naming resolves the D1 database
     * name, the real service issues the DELETE + INSERT against the (faked)
     * query API, and the reported `replaced` count reaches stdout.
     */
    it("resolves the D1 db name and passes --reset through to the baseline", async ({
      expect,
    }) => {
      const { cli, cmd, api, captureStdout } = await create();
      api.appliedNames = ["0001_old.sql", "0002_old.sql"];
      // No `.env.production` written: the Postgres/Hyperdrive guard only
      // reads `.env.<env>` (never `process.env`), so an absent file
      // correctly falls through to the D1 path, exercised for real here.

      const output = await captureStdout(() =>
        cli.run(cmd.testBaselineMark, {
          root: "/project",
          argv: "--env production --reset --json",
        }),
      );

      expect(
        api.sql.some((it) => it.includes("DELETE FROM d1_migrations")),
      ).toBe(true);
      expect(
        api.sql.some((it) =>
          it.includes(
            "INSERT INTO d1_migrations (name) VALUES ('0000_baseline.sql')",
          ),
        ),
      ).toBe(true);

      const parsed = JSON.parse(output);
      expect(parsed.dbName).toBe("my-app-production");
      expect(parsed.replaced).toBe(2);
    });

    /**
     * This is the exact command the production runbook now runs against
     * Lore's D1: one drizzle-kit v1 baseline folder
     * (`<tag>/migration.sql`), nothing previously recorded. Covered at the
     * unit level in `d1MigrationsApply.spec.ts`, but the command surface
     * that will actually be invoked  -  naming resolution, flag parsing,
     * `D1MigrationsService` injection, all of it  -  was only ever exercised here
     * against the flat pre-v1 layout, so a regression in how this command
     * wires up to v1 discovery would not have been caught.
     */
    it("baselines a drizzle-kit v1 layout migration, recording the folder name", async ({
      expect,
    }) => {
      const { cli, cmd, api, captureStdout } = await create({}, [
        "migrations/sqlite/20260729013337_baseline/migration.sql",
        "migrations/sqlite/20260729013337_baseline/snapshot.json",
      ]);

      const output = await captureStdout(() =>
        cli.run(cmd.testBaselineMark, {
          root: "/project",
          argv: "--env production --json",
        }),
      );

      expect(
        api.sql.some((it) =>
          it.includes(
            "INSERT INTO d1_migrations (name) VALUES ('20260729013337_baseline')",
          ),
        ),
      ).toBe(true);
      // Baselining runs no migration SQL at all, so nothing here reads a file.
      expect(api.sql.every((it) => !it.includes("CREATE TABLE `"))).toBe(true);

      const parsed = JSON.parse(output);
      expect(parsed.dbName).toBe("my-app-production");
      expect(parsed.replaced).toBe(0);
    });

    it("refuses without --reset when the deployed database has history, and touches nothing", async ({
      expect,
    }) => {
      const { cli, cmd, api } = await create();
      api.appliedNames = ["0001_old.sql"];

      await expect(
        cli.run(cmd.testBaselineMark, {
          root: "/project",
          argv: "--env production",
        }),
      ).rejects.toThrow(/--reset/);

      expect(
        api.sql.some((it) => it.includes("DELETE FROM d1_migrations")),
      ).toBe(false);
      expect(
        api.sql.some((it) => it.includes("INSERT INTO d1_migrations")),
      ).toBe(false);
    });

    it("refuses when the environment's adapter is not cloudflare", async ({
      expect,
    }) => {
      const { cli, cmd } = await create({
        environments: { production: bay() },
      });

      await expect(
        cli.run(cmd.testBaselineMark, {
          root: "/project",
          argv: "--env production",
        }),
      ).rejects.toThrow(/only supports Cloudflare D1/);
    });

    it("refuses when the environment is backed by Postgres/Hyperdrive, not D1", async ({
      expect,
    }) => {
      const { fs, cli, cmd } = await create();
      await fs.writeFile(
        "/project/.env.production",
        "DATABASE_URL=postgres://user:pass@host/db",
      );

      await expect(
        cli.run(cmd.testBaselineMark, {
          root: "/project",
          argv: "--env production",
        }),
      ).rejects.toThrow(/Postgres\/Hyperdrive/);
    });
  });
});

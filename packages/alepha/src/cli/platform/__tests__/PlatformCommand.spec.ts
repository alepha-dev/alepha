import { join as nodeJoin } from "node:path";

import { Alepha } from "alepha";
import {
  CloudflareAdapter,
  platformOptions,
  WranglerApi,
} from "alepha/cli/platform-lib";
import { CliProvider } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { PlatformCommand } from "../commands/platform.ts";

/**
 * `authenticate()` shells out to wrangler for login/version checks and hits
 * the real Cloudflare REST API for account resolution. None of that is
 * under test here — only that `platform db baseline mark` resolves the
 * right D1 database name (naming) and reaches
 * `WranglerApi.d1MigrationsBaseline` with the right arguments — so it is
 * stubbed to a no-op, same as a real `platform up` would have already
 * authenticated in an earlier step.
 */
class FakeCloudflareAdapter extends CloudflareAdapter {
  public override async authenticate(): Promise<void> {}
}

class TestPlatformCommand extends PlatformCommand {
  public readonly testBaselineMark = this.baselineMark;
}

/**
 * `WranglerApi` is used for real (not substituted) — only its `shell`/`fs`
 * collaborators are swapped, exactly like `d1MigrationsApply.spec.ts`. That
 * proves the whole chain (naming -> dbName -> WranglerApi call -> shelled
 * wrangler commands) actually works end-to-end, not just that the right
 * method gets called.
 */
class FakeShell {
  public readonly commands: string[] = [];
  public appliedNames: string[] = [];

  async run(command: string) {
    this.commands.push(command);
    if (command.includes("SELECT name FROM d1_migrations")) {
      return JSON.stringify([
        { results: this.appliedNames.map((name) => ({ name })) },
      ]);
    }
    return "";
  }
}

/**
 * Models just enough of a real filesystem for migration discovery: `ls(dir)`
 * returns the immediate child names under `dir` (files and directories
 * alike, same as a raw `readdir`), and `exists(path)` is true for a known
 * file or a directory with something nested under it.
 *
 * The previous version of this fixture returned a fixed file list
 * regardless of the directory queried, and `exists()` was unconditionally
 * `true` for any path. That shape structurally cannot distinguish the v1
 * folder-per-migration layout (`<tag>/migration.sql`) from an empty
 * directory or from a directory that merely looks like it might hold one —
 * so this end-to-end suite could pass without ever exercising v1 discovery
 * through the actual `alepha platform db baseline mark` command surface,
 * even after the underlying `WranglerApi` logic was fixed and unit-tested
 * elsewhere.
 */
class FakeFs {
  constructor(protected readonly paths: Set<string>) {}

  join(...parts: string[]) {
    return nodeJoin(...parts);
  }

  async exists(path: string) {
    if (this.paths.has(path)) return true;
    return [...this.paths].some((p) => p.startsWith(`${path}/`));
  }

  async ls(dir: string) {
    const prefix = `${dir}/`;
    const names = new Set<string>();
    for (const p of this.paths) {
      if (p.startsWith(prefix)) {
        names.add(p.slice(prefix.length).split("/")[0] as string);
      }
    }
    return [...names];
  }
}

describe("PlatformCommand", () => {
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
      const cmd = alepha.inject(TestPlatformCommand);

      const wrangler = alepha.inject(WranglerApi);
      const shell = new FakeShell();
      const wranglerFs = new FakeFs(
        new Set(migrationPaths.map((p) => nodeJoin("/project", p))),
      );
      Object.assign(wrangler as unknown as Record<string, unknown>, {
        shell,
        fs: wranglerFs,
      });

      alepha.set(platformOptions, {
        name: "my-app",
        environments: { production: { adapter: "cloudflare" } },
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

      return { alepha, fs, cli, cmd, shell, wranglerFs, captureStdout };
    };

    /**
     * The whole point of Task 4's CLI half: `--reset` on `alepha platform db
     * baseline mark` must actually reach `WranglerApi.d1MigrationsBaseline`
     * (previously it was declared on core `alepha db baseline mark` and read
     * by nothing). Proven end-to-end: real naming resolves the D1 database
     * name, the real `WranglerApi` issues the DELETE + INSERT against the
     * (faked) shell, and the reported `replaced` count reaches stdout.
     */
    it("resolves the D1 db name and passes --reset through to d1MigrationsBaseline", async ({
      expect,
    }) => {
      const { cli, cmd, shell, captureStdout } = await create();
      shell.appliedNames = ["0001_old.sql", "0002_old.sql"];
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
        shell.commands.some((c) =>
          c.startsWith("wrangler d1 execute my-app-production --remote"),
        ),
      ).toBe(true);
      expect(
        shell.commands.some((c) => c.includes("DELETE FROM d1_migrations")),
      ).toBe(true);
      expect(
        shell.commands.some((c) =>
          c.includes(
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
     * that will actually be invoked — naming resolution, flag parsing,
     * `WranglerApi` injection, all of it — was only ever exercised here
     * against the flat pre-v1 layout, so a regression in how this command
     * wires up to v1 discovery would not have been caught.
     */
    it("baselines a drizzle-kit v1 layout migration, recording the folder name", async ({
      expect,
    }) => {
      const { cli, cmd, shell, captureStdout } = await create({}, [
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
        shell.commands.some((c) =>
          c.includes(
            "INSERT INTO d1_migrations (name) VALUES ('20260729013337_baseline')",
          ),
        ),
      ).toBe(true);
      expect(shell.commands.some((c) => c.includes("--file="))).toBe(false);

      const parsed = JSON.parse(output);
      expect(parsed.dbName).toBe("my-app-production");
      expect(parsed.replaced).toBe(0);
    });

    it("refuses without --reset when the deployed database has history, and touches nothing", async ({
      expect,
    }) => {
      const { cli, cmd, shell } = await create();
      shell.appliedNames = ["0001_old.sql"];

      await expect(
        cli.run(cmd.testBaselineMark, {
          root: "/project",
          argv: "--env production",
        }),
      ).rejects.toThrowError(/--reset/);

      expect(
        shell.commands.some((c) => c.includes("DELETE FROM d1_migrations")),
      ).toBe(false);
      expect(
        shell.commands.some((c) => c.includes("INSERT INTO d1_migrations")),
      ).toBe(false);
    });

    it("refuses when the environment's adapter is not cloudflare", async ({
      expect,
    }) => {
      const { cli, cmd } = await create({
        environments: { production: { adapter: "bay" } },
      });

      await expect(
        cli.run(cmd.testBaselineMark, {
          root: "/project",
          argv: "--env production",
        }),
      ).rejects.toThrowError(/only supports Cloudflare D1/);
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
      ).rejects.toThrowError(/Postgres\/Hyperdrive/);
    });
  });
});

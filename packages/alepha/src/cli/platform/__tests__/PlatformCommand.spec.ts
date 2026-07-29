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
 * right D1 database name (naming/tenancy) and reaches
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

class FakeFs {
  public files: string[] = ["0000_baseline.sql"];

  join(...parts: string[]) {
    return parts.join("/");
  }
  async exists() {
    return true;
  }
  async ls() {
    return this.files;
  }
}

describe("PlatformCommand", () => {
  describe("db baseline mark", () => {
    const create = (config: Record<string, unknown> = {}) => {
      const alepha = Alepha.create()
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
        .with({ provide: CloudflareAdapter, use: FakeCloudflareAdapter });

      const fs = alepha.inject(MemoryFileSystemProvider);
      const cli = alepha.inject(CliProvider);
      const cmd = alepha.inject(TestPlatformCommand);

      const wrangler = alepha.inject(WranglerApi);
      const shell = new FakeShell();
      const wranglerFs = new FakeFs();
      Object.assign(wrangler as unknown as Record<string, unknown>, {
        shell,
        fs: wranglerFs,
      });

      alepha.set(platformOptions, {
        name: "my-app",
        environments: { production: { adapter: "cloudflare" } },
        ...config,
      } as any);

      fs.writeFile("/project/package.json", JSON.stringify({ name: "my-app" }));

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
      const { fs, cli, cmd, shell, captureStdout } = create();
      shell.appliedNames = ["0001_old.sql", "0002_old.sql"];
      // `vitest.config.ts` sets a global `process.env.DATABASE_URL` (used by
      // other suites' Postgres tests) that the handler's fallback would
      // otherwise pick up — set an explicit D1 URL so this test isn't at the
      // mercy of ambient process env.
      await fs.writeFile(
        "/project/.env.production",
        "DATABASE_URL=d1://DB\nPUBLIC_URL=https://example.com",
      );

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

    it("refuses without --reset when the deployed database has history, and touches nothing", async ({
      expect,
    }) => {
      const { fs, cli, cmd, shell } = create();
      shell.appliedNames = ["0001_old.sql"];
      await fs.writeFile(
        "/project/.env.production",
        "DATABASE_URL=d1://DB\nPUBLIC_URL=x",
      );

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

    it("names D1 resources with the tenant prefix when --tenant is given", async ({
      expect,
    }) => {
      const { fs, cli, cmd, shell } = create({ tenancy: "optional" });
      await fs.writeFile(
        "/project/.env.production",
        "DATABASE_URL=d1://DB\nPUBLIC_URL=x",
      );

      await cli.run(cmd.testBaselineMark, {
        root: "/project",
        argv: "--env production --tenant b14",
      });

      expect(
        shell.commands.some((c) =>
          c.startsWith("wrangler d1 execute b14-my-app-production --remote"),
        ),
      ).toBe(true);
    });

    it("refuses when the environment's adapter is not cloudflare", async ({
      expect,
    }) => {
      const { cli, cmd } = create({
        environments: { production: { adapter: "vercel" } },
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
      const { fs, cli, cmd } = create();
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

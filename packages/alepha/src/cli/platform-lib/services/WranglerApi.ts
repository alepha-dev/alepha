import { $inject } from "alepha";
import { AlephaCliUtils, PackageManagerUtils } from "alepha/cli";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * Wraps wrangler CLI commands that are kept as shell-outs.
 *
 * Only used for operations where wrangler provides value
 * beyond a raw API call: OAuth login, worker deploy (bundling/upload),
 * D1 migrations, and secret bulk push.
 */
export class WranglerApi {
  protected readonly log = $logger();
  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);

  protected async runShell(
    command: string,
    options: Parameters<ShellProvider["run"]>[1] = {},
  ) {
    const output = await this.shell.run(command, options);

    // When the caller captured the output, echo it to the log so the user
    // still sees it (uncaptured commands stream straight to the terminal).
    if (options.capture) {
      this.log.info(output);
    }

    return output;
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /**
   * Ensure wrangler is installed in the project.
   */
  public async ensureInstalled(root: string): Promise<void> {
    await this.pm.ensureDependency(root, "wrangler", {
      dev: true,
      exec: async (cmd, opts) => {
        await this.utils.exec(cmd, opts);
      },
    });
  }

  /**
   * Check if the user is authenticated. Returns the whoami output.
   */
  public async whoami(): Promise<string> {
    return await this.runShell("wrangler whoami", {
      resolve: true,
      capture: true,
    });
  }

  /**
   * Open the browser-based OAuth login flow.
   */
  public async login(): Promise<void> {
    await this.runShell("wrangler login", { resolve: true });
  }

  /**
   * Get the current auth token from wrangler (auto-refreshes if expired).
   */
  public async getAuthToken(): Promise<string> {
    const output = await this.shell.run("wrangler auth token --json", {
      resolve: true,
      capture: true,
    });

    const parsed = JSON.parse(output) as { type: string; token: string };
    return parsed.token;
  }

  // -------------------------------------------------------------------------
  // Deploy
  // -------------------------------------------------------------------------

  /**
   * Deploy a worker via wrangler (handles bundling and upload).
   *
   * Returns the workers.dev URL if found in the output.
   */
  public async deploy(
    workerName: string,
    configPath: string,
    root?: string,
  ): Promise<string | undefined> {
    const output = await this.runShell(
      `wrangler deploy --name=${workerName} --no-bundle --config=${configPath}`,
      { resolve: true, capture: true, root },
    );

    const match = output.match(/https:\/\/[^\s]*\.workers\.dev/);
    return match?.[0];
  }

  // -------------------------------------------------------------------------
  // D1 Migrations
  // -------------------------------------------------------------------------

  /**
   * Apply D1 migrations remotely.
   */
  /**
   * Apply pending D1 migrations.
   *
   * Deliberately NOT `wrangler d1 migrations apply`. That command runs each
   * migration inside a transaction — its own help says "this migration will
   * be rolled back" on error — and SQLite **ignores `PRAGMA foreign_keys`
   * inside a transaction**. drizzle-kit opens every generated table-rebuild
   * with `PRAGMA foreign_keys=OFF` precisely to survive the `DROP TABLE`,
   * so under `migrations apply` that pragma is silently void, foreign keys
   * stay enforced, and `DROP TABLE` — which performs an implicit
   * `DELETE FROM` — cascades every child row away. The migration then
   * reports success.
   *
   * That is not theoretical: it destroyed 2434 rows across five tables in a
   * production deploy, from a schema change that touched none of them.
   *
   * Verified against a real D1, same migrations, same database:
   *   wrangler d1 migrations apply  -> 0 of 5 child rows survive
   *   wrangler d1 execute --file    -> 5 of 5 survive
   *
   * So we drive `execute --file` ourselves and keep wrangler's own
   * `d1_migrations` bookkeeping table, which stays compatible with
   * `wrangler d1 migrations list`. The trade-off is losing per-migration
   * rollback — which is what causes the bug, and is illusory for a table
   * rebuild anyway, since the original table is already gone.
   */
  public async d1MigrationsApply(
    dbName: string,
    configPath: string,
    root?: string,
    migrationsDir = "migrations/sqlite",
  ): Promise<void> {
    const run = (args: string) =>
      this.runShell(`wrangler d1 execute ${dbName} --remote ${args}`, {
        resolve: true,
        env: { CI: "1" },
        root,
        capture: true,
      });

    // Same shape wrangler creates, so `d1 migrations list` keeps working.
    await run(
      `--command="CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);"`,
    );

    const listed = await run(
      `--command="SELECT name FROM d1_migrations;" --json`,
    );
    const applied = new Set(
      [...String(listed).matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]),
    );

    const dir = this.fs.join(root ?? ".", migrationsDir);
    // `ls` is a raw readdir and throws ENOENT for a missing directory —
    // an app with no migrations folder is a valid state, not an error.
    const entries = (await this.fs.exists(dir)) ? await this.fs.ls(dir) : [];
    const files = entries
      .map((f) => f.split("/").pop() as string)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      this.log.info("No pending D1 migrations");
      return;
    }

    for (const file of pending) {
      this.log.info(`Applying ${file} ...`);
      await run(`--file="${this.fs.join(dir, file)}"`);
      await run(
        `--command="INSERT INTO d1_migrations (name) VALUES ('${file.replace(/'/g, "''")}');"`,
      );
    }

    this.log.info(`Applied ${pending.length} D1 migration(s)`);
  }
}

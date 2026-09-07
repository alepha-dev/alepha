import { $inject } from "alepha";
import { AlephaCliUtils, PackageManagerUtils } from "alepha/cli";
import { $logger } from "alepha/logger";
import { ShellProvider } from "alepha/system";

/**
 * Wraps wrangler CLI commands that are kept as shell-outs.
 *
 * Only used for operations where wrangler provides value
 * beyond a raw API call: OAuth login, worker deploy (bundling/upload),
 * and secret bulk push.
 *
 * ⚠️ **Every method here spawns a process**, so nothing on this class can run
 * inside a Worker. That is why D1 migrations left (#1514) and why the
 * `workerd` entry of `alepha/cli/platform-lib` does not export it.
 */
export class WranglerApi {
  protected readonly log = $logger();
  protected readonly shell = $inject(ShellProvider);
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

  /*
    They moved to `D1MigrationsService`, which posts to the D1 query API
    instead of shelling out to `wrangler d1 execute` (#1514). Only the
    transport changed: discovery, ordering, the `d1_migrations` bookkeeping
    table and the refusal on an unrecognizable directory are the same code.

    ⚠️ The reason it had to move is that `orchestrator.up()`'s migrate step was
    the one part of a Cloudflare deploy that spawned a process, and a Worker
    cannot. Anything reaching for `wrangler d1 execute` here again puts that
    back.
  */
}

import { $inject, AlephaError } from "alepha";
import { AlephaCliUtils, PackageManagerUtils } from "alepha/cli";
import { $logger } from "alepha/logger";
import { ShellProvider } from "alepha/system";

/**
 * Wraps wrangler CLI commands that are kept as shell-outs.
 *
 * Only used for operations where wrangler provides value
 * beyond a raw API call: OAuth login, and worker deploy (bundling/upload,
 * secrets included).
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
   *
   * `secretsFile` is a JSON file of secrets uploaded WITH the script, as
   * `secret_text` bindings of the same version (`--secrets-file`). It needs a
   * wrangler that knows the flag, which every wrangler 4 this repository pins
   * does; an older one refuses it, and the refusal is named rather than left
   * as a yargs error.
   */
  public async deploy(
    workerName: string,
    configPath: string,
    root?: string,
    options: { secretsFile?: string } = {},
  ): Promise<string | undefined> {
    const secretsFlag = options.secretsFile
      ? ` --secrets-file=${options.secretsFile}`
      : "";
    let output: string;
    try {
      output = await this.runShell(
        `wrangler deploy --name=${workerName} --no-bundle --config=${configPath}${secretsFlag}`,
        { resolve: true, capture: true, root },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (secretsFlag && /unknown argument.*secrets-file/i.test(message)) {
        throw new AlephaError(
          "This project's wrangler does not know `wrangler deploy --secrets-file`, which is how a deploy uploads its secrets with the code. Upgrade wrangler to a current 4.x.",
          { cause: error },
        );
      }
      throw error;
    }

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

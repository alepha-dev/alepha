import { $inject, AlephaError } from "alepha";
import { AlephaCliUtils, PackageManagerUtils } from "alepha/cli";
import { $logger } from "alepha/logger";
import { ShellProvider } from "alepha/system";

/**
 * Wraps the wrangler commands kept as shell-outs: interactive login and
 * logout, and reading the token a login left.
 *
 * Wrangler stays for login only (folio #F1374): Cloudflare opens its device
 * grant to first-party clients only, and wrangler already stores, refreshes
 * and scopes the OAuth token. Deploying, provisioning and migrating go over
 * the API (#E75), and with `CLOUDFLARE_API_TOKEN` set nothing here runs at
 * all: see `CloudflareCredentialSource`. The one other shell-out left is
 * `alepha infra db export`'s `wrangler d1 export` (#Q2616).
 *
 * ⚠️ **Every method here spawns a process**, so nothing on this class can run
 * inside a Worker. That is why D1 migrations left (#1514) and why the
 * `workerd` entry of `alepha/cli/infra-lib` does not export it.
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
   * Open the OAuth login flow.
   *
   * `device` asks for the RFC 8628 device flow (`wrangler login --device`): a
   * code to type on another machine, for SSH sessions and containers with no
   * browser. It needs wrangler 4.119.0 or later; an older one refuses the
   * flag, and that refusal is named rather than left as a yargs error.
   */
  public async login(options: { device?: boolean } = {}): Promise<void> {
    const command = options.device
      ? "wrangler login --device"
      : "wrangler login";
    try {
      await this.runShell(command, { resolve: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.device && /unknown argument.*device/i.test(message)) {
        throw new AlephaError(
          "This project's wrangler does not know `wrangler login --device`. Upgrade wrangler to 4.119.0 or later.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * Discard wrangler's stored login.
   */
  public async logout(root?: string): Promise<void> {
    await this.shell.run("wrangler logout", { root });
  }

  /**
   * Get the current auth token from wrangler (auto-refreshes if expired).
   *
   * Answered with its `type`: `oauth` and `api_token` carry a bearer `token`,
   * while `api_key` is a global key and an email, which no caller here can
   * send. `CloudflareCredentialSource` refuses that one by name.
   */
  public async getAuthToken(): Promise<{ type: string; token?: string }> {
    const output = await this.shell.run("wrangler auth token --json", {
      resolve: true,
      capture: true,
    });

    return JSON.parse(output) as { type: string; token?: string };
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

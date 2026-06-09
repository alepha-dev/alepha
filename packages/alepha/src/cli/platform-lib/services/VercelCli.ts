import { homedir, platform } from "node:os";
import { join } from "node:path";
import { $inject, AlephaError } from "alepha";
import { AlephaCliUtils, PackageManagerUtils } from "alepha/cli";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * Wraps Vercel CLI commands and token management.
 *
 * Used for operations where the Vercel CLI provides value:
 * OAuth login, prebuilt deploy, and auth token extraction.
 */
export class VercelCli {
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
  // Install
  // -------------------------------------------------------------------------

  /**
   * Ensure vercel CLI is installed in the project.
   */
  public async ensureInstalled(root: string): Promise<void> {
    await this.pm.ensureDependency(root, "vercel", {
      dev: true,
      exec: async (cmd, opts) => {
        await this.utils.exec(cmd, opts);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /**
   * Get the Vercel auth token.
   *
   * Priority:
   * 1. VERCEL_TOKEN environment variable (CI/CD)
   * 2. Vercel CLI auth.json file (local dev)
   */
  public async getAuthToken(): Promise<string> {
    const envToken = process.env.VERCEL_TOKEN;
    if (envToken) {
      return envToken;
    }

    const authPath = this.getAuthFilePath();
    if (!(await this.fs.exists(authPath))) {
      throw new AlephaError(
        "Vercel auth token not found. Run `vercel login` or set VERCEL_TOKEN.",
      );
    }

    const content = await this.fs.readFile(authPath);
    const parsed = JSON.parse(content.toString()) as { token?: string };

    if (!parsed.token) {
      throw new AlephaError(
        "Vercel auth.json exists but contains no token. Run `vercel login`.",
      );
    }

    return parsed.token;
  }

  /**
   * Validate the current auth token.
   */
  public async whoami(): Promise<string> {
    return await this.runShell("vercel whoami", {
      resolve: true,
      capture: true,
    });
  }

  /**
   * Open the browser-based login flow.
   */
  public async login(): Promise<void> {
    await this.runShell("vercel login", { resolve: true });
  }

  // -------------------------------------------------------------------------
  // Deploy
  // -------------------------------------------------------------------------

  /**
   * Deploy a prebuilt .vercel/output/ directory.
   *
   * Returns the deployment URL.
   */
  public async deploy(
    distDir: string,
    options: { prod?: boolean; token?: string },
  ): Promise<string | undefined> {
    const args = ["vercel", "deploy", "--prebuilt"];

    if (options.prod) {
      args.push("--prod");
    }

    if (options.token) {
      args.push(`--token=${options.token}`);
    }

    const output = await this.runShell(args.join(" "), {
      resolve: true,
      capture: true,
      root: distDir,
    });

    // Vercel CLI outputs the deployment URL on the last non-empty line
    const lines = output.trim().split("\n");
    const url = lines
      .reverse()
      .find((line) => line.trim().startsWith("https://"));
    return url?.trim();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the path to Vercel CLI auth.json.
   */
  protected getAuthFilePath(): string {
    const os = platform();

    if (os === "darwin") {
      return join(
        homedir(),
        "Library",
        "Application Support",
        "com.vercel.cli",
        "auth.json",
      );
    }

    if (os === "win32") {
      return join(
        homedir(),
        "AppData",
        "Roaming",
        "xdg.data",
        "com.vercel.cli",
        "auth.json",
      );
    }

    // Linux / other
    return join(homedir(), ".local", "share", "com.vercel.cli", "auth.json");
  }
}

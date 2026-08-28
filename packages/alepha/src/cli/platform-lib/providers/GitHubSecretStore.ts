import { randomUUID } from "node:crypto";

import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import type {
  RemoteSecret,
  SecretStoreProvider,
} from "./SecretStoreProvider.ts";

/**
 * GitHub Actions secret store backed by the `gh` CLI.
 *
 * Requires the GitHub CLI (`gh`) to be installed and authenticated.
 * Pushes secrets into GitHub Actions environments.
 */
export class GitHubSecretStore implements SecretStoreProvider {
  protected readonly log = $logger();
  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Verify that `gh` is installed and authenticated.
   */
  public async ensureAvailable(): Promise<void> {
    const installed = await this.shell.isInstalled("gh");
    if (!installed) {
      throw new AlephaError(
        "GitHub CLI (gh) is not installed. Install it from https://cli.github.com",
      );
    }

    try {
      await this.shell.run("gh auth status", { capture: true });
    } catch {
      throw new AlephaError(
        "GitHub CLI is not authenticated. Run `gh auth login` first.",
      );
    }
  }

  /**
   * Create the GitHub Actions environment if it doesn't exist.
   */
  public async ensureEnvironment(environment: string): Promise<void> {
    await this.shell.run(
      [
        "gh",
        "api",
        "--method",
        "PUT",
        `/repos/{owner}/{repo}/environments/${environment}`,
        "--silent",
      ],
      { capture: true },
    );
    this.log.debug(`Ensured environment "${environment}" exists`);
  }

  /**
   * List all secrets in a GitHub Actions environment.
   */
  public async list(environment: string): Promise<RemoteSecret[]> {
    try {
      const output = await this.shell.run(
        [
          "gh",
          "secret",
          "list",
          "--env",
          environment,
          "--json",
          "name,updatedAt",
        ],
        { capture: true },
      );

      const parsed = JSON.parse(output || "[]") as Array<{
        name: string;
        updatedAt?: string;
      }>;

      return parsed.map((s) => ({
        name: s.name,
        updatedAt: s.updatedAt,
      }));
    } catch (error) {
      if (this.isMissingStore(error)) {
        this.log.debug("No secret store for this environment yet", {
          environment,
        });
        return [];
      }
      throw new AlephaError(
        `Could not list GitHub secrets for environment "${environment}": ${this.ghMessage(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Whether a failed `gh secret list` means "there is no store here" rather
   * than "we could not ask".
   *
   * Only a 404 qualifies. Everything else - an expired token, a rate limit, a
   * DNS failure - used to be swallowed into an empty list, and an empty list
   * is not "unknown": `alepha platform` reads it as "no secret is set" and
   * goes on to report a clean state or push a duplicate.
   *
   * ⚠️ GitHub answers 404 for a private repository the token cannot see, so a
   * scoping mistake still reads as an empty store. `ensureAvailable()` is what
   * catches that, by checking `gh auth status` before any of this runs.
   */
  protected isMissingStore(error: unknown): boolean {
    return /HTTP 404|\bnot found\b/i.test(this.ghMessage(error));
  }

  /**
   * What `gh` actually said. `ShellProvider.run` puts stderr in the message
   * and also hangs it off the error, and the memory provider used by tests
   * only has the message - so read both.
   */
  protected ghMessage(error: unknown): string {
    const stderr = (error as { stderr?: string } | undefined)?.stderr;
    if (stderr?.trim()) return stderr.trim();
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Set a secret in a GitHub Actions environment.
   *
   * Writes a dotenv-formatted file and uses `gh secret set --env-file` to
   * avoid shell pipe issues with NodeShellProvider escaping the `|` character.
   */
  public async set(
    environment: string,
    key: string,
    value: string,
  ): Promise<void> {
    // The plaintext secret briefly hits disk. Put it in a private,
    // unpredictably-named directory (mode 0700) instead of a guessable
    // /tmp path: on a shared machine any local user could otherwise read it
    // — or pre-create the path and have us write into their file.
    const dir = this.fs.join(
      "node_modules",
      ".alepha",
      "secrets",
      randomUUID(),
    );
    await this.fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const tmpFile = this.fs.join(dir, "secret.env");
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    await this.fs.writeFile(tmpFile, `${key}="${escaped}"\n`);
    try {
      const output = await this.shell.run(
        ["gh", "secret", "set", "-f", tmpFile, "--env", environment],
        { capture: true },
      );
      this.log.debug(`Secret set: ${key}`, { output });
    } finally {
      await this.fs.rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Delete a secret from a GitHub Actions environment.
   */
  public async delete(environment: string, key: string): Promise<void> {
    await this.shell.run(
      ["gh", "secret", "delete", key, "--env", environment],
      { capture: true },
    );
  }
}

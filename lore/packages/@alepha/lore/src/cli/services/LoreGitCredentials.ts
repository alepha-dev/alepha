import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { ShellProvider } from "alepha/system";

/**
 * The `lore` CLI as git's credential helper (#Q3934): nobody copies a token
 * by hand to clone or push a Lore repository.
 *
 * ## Installed as `gh` installs its own
 *
 * Per Lore host, in the global git config:
 *
 * ```ini
 * [credential "https://lore.alepha.app"]
 *   helper =
 *   helper = !'<node>' '<lore>' git-credential
 * ```
 *
 * The empty entry first resets the helper list for that host, so the
 * system's keychain helper is never asked, and never STORES what this one
 * answers: an access token lives 15 minutes, and a keychain would hand it
 * back stale long after. The command names the running binary by absolute
 * path, as `gh` does, so it works whether `lore` is on the `PATH` or not.
 *
 * ## What it answers
 *
 * `get` prints `username` and `password`, the password being what
 * `LoreClientService.authorization` gives the CLI itself: `LORE_API_KEY`
 * when set (CI), else the login's access token, refreshed when it expired.
 * `store` and `erase` do nothing.
 */
export class LoreGitCredentials {
  protected readonly shell = $inject(ShellProvider);
  protected readonly log = $logger();

  /**
   * The helper line git runs, naming this very binary.
   */
  public helperCommand(): string {
    const argv = globalThis.process?.argv ?? [];
    const node = argv[0];
    const script = argv[1];
    if (!node || !script) return "!lore git-credential";
    return `!${this.quote(node)} ${this.quote(script)} git-credential`;
  }

  /**
   * The config key for one Lore host: `credential.<origin>.helper`.
   */
  public keyOf(hostname: string): string {
    return `credential.${new URL(hostname).origin}.helper`;
  }

  /**
   * Install the helper for a Lore host, replacing whatever that host had.
   * Best effort: a machine without git is told, never refused.
   */
  public async install(hostname: string): Promise<boolean> {
    const key = this.keyOf(hostname);
    try {
      // Exit 5 when the key is absent: nothing to unset is fine.
      await this.shell.capture([
        "git",
        "config",
        "--global",
        "--unset-all",
        key,
      ]);
      await this.shell.run(["git", "config", "--global", "--add", key, ""]);
      await this.shell.run([
        "git",
        "config",
        "--global",
        "--add",
        key,
        this.helperCommand(),
      ]);
      return true;
    } catch (error) {
      this.log.warn(
        `Could not install the git credential helper for ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * git's credential description: `key=value` lines, ended by a blank one.
   */
  public parse(input: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const line of input.split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at > 0) fields[line.slice(0, at)] = line.slice(at + 1);
    }
    return fields;
  }

  /**
   * The answer to `get`.
   */
  public answer(password: string): string {
    return `username=lore\npassword=${password}\n`;
  }

  protected quote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }
}

import { $env, $inject, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider } from "alepha/system";

/**
 * Where a device-flow token lives between invocations.
 *
 * ## ⚠️ Keyed by hostname, and that is not tidiness
 *
 * One laptop can talk to the public Lore and to a self-hosted one, and a token
 * minted by either is worthless to the other - worse, sending one to the other
 * hands a credential to a host that was never meant to see it. The file holds
 * a map, and `LORE_URL` picks the entry.
 *
 * ## ⚠️ The DIRECTORY is 0700, not the file
 *
 * `FileSystemProvider.writeFile` takes no mode, so the token file lands with
 * whatever the umask says - typically world-readable. The containing directory
 * is created `0o700` instead, which is the same protection `~/.ssh` relies on:
 * a file nobody can traverse into is a file nobody can read, whatever its own
 * bits say.
 *
 * Worth knowing rather than worth hiding: if `writeFile` ever grows a `mode`,
 * this should set one as well rather than instead.
 */
export class LoreTokenStore {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly env = $env(
    z.object({
      /**
       * The user's home directory. Read through `$env` rather than
       * `os.homedir()` so the store is substitutable with
       * `MemoryFileSystemProvider` in a test, which is the only way the
       * write path is ever exercised.
       */
      HOME: z.text({ default: "", secret: false }).optional(),
      /**
       * Windows' spelling of the same thing.
       */
      USERPROFILE: z.text({ default: "", secret: false }).optional(),
    }),
  );

  /**
   * Directory holding the credentials file. `.alepha` under the home
   * directory, beside nothing else today.
   */
  public static readonly DIR = ".alepha";

  public static readonly FILE = "credentials.json";

  /**
   * The token for a hostname, refreshed if it has aged out and can be.
   *
   * `undefined` rather than a throw when there is none: a missing token is one
   * of three ways to authenticate and the caller decides what to do about it.
   */
  public async read(hostname: string): Promise<string | undefined> {
    const file = await this.load();
    const entry = file.hosts[hostname];
    if (!entry) {
      return undefined;
    }
    if (!this.expired(entry)) {
      return entry.accessToken;
    }
    // An expired token with nothing to refresh from is a token that is simply
    // gone. Returning it would send a credential the server will refuse, and
    // the refusal would read as "your key is wrong" rather than "log in
    // again".
    return undefined;
  }

  /**
   * The whole entry, for a caller that can refresh it. Kept separate from
   * {@link read} so the common path - "give me a bearer" - cannot accidentally
   * become a network call.
   */
  public async entry(hostname: string): Promise<LoreToken | undefined> {
    const file = await this.load();
    return file.hosts[hostname];
  }

  public expired(token: LoreToken): boolean {
    if (!token.expiresAt) {
      return false;
    }
    // A minute of slack, so a token that expires mid-request is treated as
    // already gone rather than sent and refused.
    return (
      this.dateTime.of(token.expiresAt).valueOf() - 60_000 <
      this.dateTime.nowMillis()
    );
  }

  public async write(hostname: string, token: LoreToken): Promise<void> {
    const file = await this.load();
    file.hosts[hostname] = token;
    await this.save(file);
  }

  /**
   * Forget one hostname. Returns whether there was anything to forget, so
   * `logout` can say "you were not logged in" instead of implying it just
   * revoked something.
   */
  public async clear(hostname: string): Promise<boolean> {
    const file = await this.load();
    if (!file.hosts[hostname]) {
      return false;
    }
    delete file.hosts[hostname];
    await this.save(file);
    return true;
  }

  public path(): string {
    const home = String(this.env.HOME || this.env.USERPROFILE || "");
    if (!home) {
      throw new AlephaError(
        "Neither HOME nor USERPROFILE is set, so there is nowhere to keep a login. Use LORE_API_KEY instead.",
      );
    }
    return this.fs.join(home, LoreTokenStore.DIR, LoreTokenStore.FILE);
  }

  /**
   * The file, or an empty one.
   *
   * A file that cannot be parsed reads as empty rather than throwing. The
   * failure it would otherwise cause is the worst kind: every `lore` command
   * stops working because of a stray byte in a cache, and the fix -
   * delete the file - is not something the error would suggest.
   */
  protected async load(): Promise<LoreCredentialsFile> {
    const path = this.path();
    if (!(await this.fs.exists(path))) {
      return { version: 1, hosts: {} };
    }
    try {
      const parsed = await this.fs.readJsonFile<LoreCredentialsFile>(path);
      return { version: 1, hosts: parsed?.hosts ?? {} };
    } catch {
      return { version: 1, hosts: {} };
    }
  }

  protected async save(file: LoreCredentialsFile): Promise<void> {
    const path = this.path();
    await this.fs.mkdir(this.fs.join(this.homeDir(), LoreTokenStore.DIR), {
      recursive: true,
      // See the class doc: this is what protects the token, since the file
      // itself gets whatever the umask allows.
      mode: 0o700,
    });
    await this.fs.writeJsonFile(path, file);
  }

  protected homeDir(): string {
    return String(this.env.HOME || this.env.USERPROFILE || "");
  }
}

export interface LoreToken {
  accessToken: string;
  /**
   * Absent when the grant returned none, which is legal.
   */
  refreshToken?: string;
  /**
   * ISO instant. Absent when the grant named no lifetime, which reads as "does
   * not expire" rather than "already expired".
   */
  expiresAt?: string;
}

export interface LoreCredentialsFile {
  version: 1;
  hosts: Record<string, LoreToken>;
}

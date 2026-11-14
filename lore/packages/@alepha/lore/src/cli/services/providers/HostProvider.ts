/**
 * A server `lore host provision` creates (#Q3164).
 */
export interface ProvisionedServer {
  /**
   * The provider's own id for the server, what `terminate` takes.
   */
  serverId: string;
  /**
   * Its public IPv4 address, known before the server boots.
   */
  publicIp: string;
}

/**
 * What a provider is asked to create.
 */
export interface ProvisionRequest {
  name: string;
  type: string;
  zone: string;
  tags: string[];
  /**
   * The cloud-init document the server runs on first boot, built from the
   * public IP the provider reserved for it, so the document can name the
   * server's own sslip.io base domain.
   */
  userData: (publicIp: string) => string;
}

/**
 * One cloud a `bay` host can be bought from, from the `lore` CLI (#Q3164,
 * epic E116).
 *
 * ⚠️ **Lore never holds a provider key.** A provider drives the provider's
 * own CLI, which the user installed and logged in with (`scw login`), through
 * `ShellProvider`: its credentials, profiles and environment variables stay
 * that CLI's business. So a provider is a CLI wrapper, never an API client
 * holding a token, and Lore's server is never in the loop.
 *
 * Every refusal names the fix, because an agent runs this from its `--help`
 * and its messages alone: {@link setup} is printed when the CLI is missing or
 * logged out, and by `lore host provision` with no `--provider`.
 */
export abstract class HostProvider {
  /**
   * The name `--provider` takes.
   */
  abstract readonly name: string;

  /**
   * One line saying what it is, for the provider list.
   */
  abstract readonly title: string;

  /**
   * What the user does once before this provider works, as commands.
   */
  abstract readonly setup: string[];

  /**
   * The server type and zone used when the user names none.
   */
  abstract readonly defaults: { type: string; zone: string };

  /**
   * Refuses, naming the fix, unless the provider's CLI is installed and
   * logged in.
   */
  abstract check(): Promise<void>;

  /**
   * The hourly price of a server type in a zone, in euros, or undefined
   * when the catalogue does not say. Read once at provision and stored.
   */
  abstract hourlyPrice(type: string, zone: string): Promise<number | undefined>;

  /**
   * Creates the server with its public IP and its user data, and starts it.
   * Leaves nothing behind when it fails.
   */
  abstract create(request: ProvisionRequest): Promise<ProvisionedServer>;

  /**
   * Destroys the server with its IP and its disks, all of what bills.
   */
  abstract terminate(serverId: string, zone: string): Promise<void>;

  /**
   * The command the user runs to finish a terminate Lore could not, printed
   * beside a failure.
   */
  abstract terminateCommand(serverId: string, zone: string): string;
}

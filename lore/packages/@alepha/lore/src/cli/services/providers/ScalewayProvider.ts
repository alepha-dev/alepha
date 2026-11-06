import { tmpdir } from "node:os";

import { $inject, AlephaError } from "alepha";
import { CommandError } from "alepha/command";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import { LoreRefusals } from "../LoreRefusals.ts";
import {
  EstateProvider,
  type ProvisionedServer,
  type ProvisionRequest,
} from "./EstateProvider.ts";

/**
 * Scaleway, over the `scw` CLI the user logged in with (#Q3164).
 *
 * The public IP is reserved first (`scw instance ip create`), so the
 * cloud-init the server is created with can already name its sslip.io base
 * domain, and the server is created and started in one call with that IP.
 * A create that fails releases the IP: a reserved IP bills.
 *
 * Terminating passes `with-ip=true with-block=true`: a plain delete leaves
 * the IP and the volume billing, which the walk of epic E114 measured.
 */
export class ScalewayProvider extends EstateProvider {
  readonly name = "scaleway";
  readonly title = "Scaleway Instances, through the scw CLI";
  readonly setup = [
    "brew install scw   (or https://www.scaleway.com/en/cli/)",
    "scw login",
  ];
  readonly defaults = { type: "DEV1-S", zone: "fr-par-1" };

  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);

  async check(): Promise<void> {
    if (!(await this.shell.isInstalled("scw"))) {
      throw this.refusal(
        `The scw CLI is not installed. Install it and log in, once:\n${this.steps()}`,
      );
    }
    const info = await this.shell.capture(["scw", "info", "-o", "json"]);
    const keys = this.parse<Array<{ key?: string; value?: string }>>(
      info.stdout,
    );
    const secret = Array.isArray(keys)
      ? keys.find((row) => row.key === "secret_key")?.value
      : undefined;
    if (info.exitCode !== 0 || !secret || secret === "-") {
      throw this.refusal("scw is installed but not logged in. Run: scw login");
    }
  }

  async hourlyPrice(type: string, zone: string): Promise<number | undefined> {
    const result = await this.shell.capture([
      "scw",
      "instance",
      "server-type",
      "list",
      `zone=${zone}`,
      "-o",
      "json",
    ]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const types =
      this.parse<
        Array<{
          name?: string;
          hourly_price?: { units?: number; nanos?: number };
        }>
      >(result.stdout) ?? [];
    const found = types.find((row) => row.name === type)?.hourly_price;
    if (!found) {
      return undefined;
    }
    return (found.units ?? 0) + (found.nanos ?? 0) / 1e9;
  }

  async create(request: ProvisionRequest): Promise<ProvisionedServer> {
    const ip = await this.json<{
      ip?: { id?: string; address?: string };
      id?: string;
      address?: string;
    }>([
      "scw",
      "instance",
      "ip",
      "create",
      `zone=${request.zone}`,
      ...request.tags.map((tag, index) => `tags.${index}=${tag}`),
      "-o",
      "json",
    ]);
    const ipId = ip.ip?.id ?? ip.id;
    const address = ip.ip?.address ?? ip.address;
    if (!ipId || !address) {
      throw new AlephaError("scw reserved no IP address");
    }

    // A file, never argv: the user data holds the enrolment secret, and
    // argv is readable by every process on the machine.
    const file = this.fs.join(
      this.tempDir(),
      `lore-cloud-init-${request.name}.yaml`,
    );
    await this.fs.writeFile(file, request.userData(address));
    try {
      const server = await this.json<{ id?: string }>(
        this.createArgv(request, ipId, file),
      );
      if (!server.id) {
        throw new AlephaError("scw created no server");
      }
      return { serverId: server.id, publicIp: address };
    } catch (error) {
      // A reserved IP bills on its own: never leave one behind.
      await this.shell.capture([
        "scw",
        "instance",
        "ip",
        "delete",
        ipId,
        `zone=${request.zone}`,
      ]);
      throw error;
    } finally {
      await this.fs.rm(file, { force: true });
    }
  }

  async terminate(serverId: string, zone: string): Promise<void> {
    const result = await this.shell.capture([
      "scw",
      "instance",
      "server",
      "terminate",
      serverId,
      `zone=${zone}`,
      "with-ip=true",
      "with-block=true",
    ]);
    if (result.exitCode !== 0) {
      throw new AlephaError(
        `scw could not terminate ${serverId}: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
      );
    }
  }

  terminateCommand(serverId: string, zone: string): string {
    return `scw instance server terminate ${serverId} zone=${zone} with-ip=true with-block=true`;
  }

  protected createArgv(
    request: ProvisionRequest,
    ipId: string,
    file: string,
  ): string[] {
    return [
      "scw",
      "instance",
      "server",
      "create",
      `type=${request.type}`,
      "image=ubuntu_noble",
      `name=${request.name}`,
      `zone=${request.zone}`,
      `ip=${ipId}`,
      ...request.tags.map((tag, index) => `tags.${index}=${tag}`),
      `cloud-init=@${file}`,
      "-o",
      "json",
    ];
  }

  /**
   * Runs an `scw` command expected to print JSON, refusing with what scw
   * said when it fails.
   */
  protected async json<T>(argv: string[]): Promise<T> {
    const result = await this.shell.capture(argv);
    if (result.exitCode !== 0) {
      throw new AlephaError(
        `${argv.slice(0, 4).join(" ")} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
      );
    }
    const parsed = this.parse<T>(result.stdout);
    if (parsed === undefined) {
      throw new AlephaError(
        `${argv.slice(0, 4).join(" ")} printed something that is not JSON`,
      );
    }
    return parsed;
  }

  /**
   * Where the cloud-init file is written for scw to read, then removed.
   */
  protected tempDir(): string {
    return tmpdir();
  }

  protected parse<T>(raw: string): T | undefined {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  protected steps(): string {
    return this.setup.map((line) => `  ${line}`).join("\n");
  }

  protected refusal(message: string): CommandError {
    return new CommandError(
      { exitCode: LoreRefusals.EXIT_FAILURE },
      { message },
    );
  }
}

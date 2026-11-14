import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { HostProviders } from "../services/providers/HostProviders.ts";
import { ScalewayProvider } from "../services/providers/ScalewayProvider.ts";

class FixedTempScaleway extends ScalewayProvider {
  protected override tempDir(): string {
    return "/tmp";
  }
}

/**
 * The Scaleway driver (#Q3164): every call is the `scw` the user logged in
 * with, so the specs pin the argv, the user data reaching its file, the JSON
 * read back, and what each refusal tells the user to run.
 */
describe("ScalewayProvider", () => {
  const create = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ScalewayProvider, use: FixedTempScaleway });
    return {
      shell: alepha.inject(MemoryShellProvider),
      fs: alepha.inject(MemoryFileSystemProvider),
      scaleway: alepha.inject(ScalewayProvider),
      providers: alepha.inject(HostProviders),
    };
  };

  const loggedIn = JSON.stringify({
    build_info: {},
    settings: [{ key: "secret_key", value: "c381a8bf-xxxx" }],
  });

  it("refuses with the install command when scw is missing, and with scw login when logged out", async ({
    expect,
  }) => {
    const { shell, scaleway } = create();
    await expect(scaleway.check()).rejects.toThrow("brew install scw");

    shell.configure({
      installedCommands: ["scw"],
      outputs: {
        "scw info -o json": JSON.stringify({ build_info: {}, settings: [] }),
      },
    });
    await expect(scaleway.check()).rejects.toThrow("Run: scw login");

    shell.outputs.set("scw info -o json", loggedIn);
    await expect(scaleway.check()).resolves.toBeUndefined();
  });

  it("reads the hourly price from the catalogue in euros", async ({
    expect,
  }) => {
    const { shell, scaleway } = create();
    shell.outputs.set(
      "scw instance server-type list zone=fr-par-1 -o json",
      JSON.stringify([
        { name: "DEV1-S", hourly_price: { units: 0, nanos: 8_976_000 } },
      ]),
    );
    expect(await scaleway.hourlyPrice("DEV1-S", "fr-par-1")).toBeCloseTo(
      0.008976,
    );
    expect(await scaleway.hourlyPrice("GP1-XL", "fr-par-1")).toBeUndefined();
  });

  it("reserves the IP, creates the server with it and the cloud-init file, then removes the file", async ({
    expect,
  }) => {
    const { shell, fs, scaleway } = create();
    shell.outputs.set(
      "scw instance ip create zone=fr-par-1 tags.0=lore tags.1=pie -o json",
      JSON.stringify({ ip: { id: "ip-1", address: "203.0.113.10" } }),
    );
    shell.outputs.set(
      "scw instance server create type=DEV1-S image=ubuntu_noble name=pie zone=fr-par-1 ip=ip-1 tags.0=lore tags.1=pie cloud-init=@/tmp/lore-cloud-init-pie.yaml -o json",
      JSON.stringify({ id: "srv-1" }),
    );

    const server = await scaleway.create({
      name: "pie",
      type: "DEV1-S",
      zone: "fr-par-1",
      tags: ["lore", "pie"],
      userData: (ip) => `#cloud-config\n# ${ip}\n`,
    });

    expect(server).toEqual({ serverId: "srv-1", publicIp: "203.0.113.10" });
    expect(
      fs.wasWrittenMatching("/tmp/lore-cloud-init-pie.yaml", /203\.0\.113\.10/),
    ).toBe(true);
    expect(fs.wasDeleted("/tmp/lore-cloud-init-pie.yaml")).toBe(true);
    // The user data never rides in argv.
    expect(shell.wasCalledMatching(/#cloud-config/)).toBe(false);
  });

  it("releases the reserved IP when the server create fails", async ({
    expect,
  }) => {
    const { shell, scaleway } = create();
    shell.outputs.set(
      "scw instance ip create zone=fr-par-1 -o json",
      JSON.stringify({ id: "ip-2", address: "203.0.113.11" }),
    );
    shell.errors.set(
      "scw instance server create type=DEV1-S image=ubuntu_noble name=pie zone=fr-par-1 ip=ip-2 cloud-init=@/tmp/lore-cloud-init-pie.yaml -o json",
      "quota exceeded",
    );

    await expect(
      scaleway.create({
        name: "pie",
        type: "DEV1-S",
        zone: "fr-par-1",
        tags: [],
        userData: () => "#cloud-config\n",
      }),
    ).rejects.toThrow("quota exceeded");
    expect(shell.wasCalled("scw instance ip delete ip-2 zone=fr-par-1")).toBe(
      true,
    );
  });

  it("terminates with the IP and the disk, and says what scw said when it cannot", async ({
    expect,
  }) => {
    const { shell, scaleway } = create();
    await scaleway.terminate("srv-1", "fr-par-1");
    expect(
      shell.wasCalled(
        "scw instance server terminate srv-1 zone=fr-par-1 with-ip=true with-block=true",
      ),
    ).toBe(true);

    shell.errors.set(
      "scw instance server terminate srv-2 zone=fr-par-1 with-ip=true with-block=true",
      "not found",
    );
    await expect(scaleway.terminate("srv-2", "fr-par-1")).rejects.toThrow(
      "not found",
    );
  });

  it("lists every provider and what it needs when none or an unknown one is named", ({
    expect,
  }) => {
    const { providers } = create();
    expect(() => providers.pick(undefined)).toThrow("--provider");
    expect(() => providers.pick(undefined)).toThrow("scw login");
    expect(() => providers.pick("ovh")).toThrow("Unknown provider ovh");
    expect(providers.pick("scaleway").name).toBe("scaleway");
  });
});

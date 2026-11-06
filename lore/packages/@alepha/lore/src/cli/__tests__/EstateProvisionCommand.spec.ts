import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { HttpError } from "alepha/server";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { EstateCommand } from "../commands/EstateCommand.ts";
import { LoreEstateProvisioner } from "../services/LoreEstateProvisioner.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { ScalewayProvider } from "../services/providers/ScalewayProvider.ts";

class FixedTempScaleway extends ScalewayProvider {
  protected override tempDir(): string {
    return "/tmp";
  }
}

/**
 * `lore estate provision` (#Q3166): one command from nothing to an estate
 * online and ready to deploy to, with every failure leaving no server Lore
 * has forgotten.
 */
describe("lore estate provision", () => {
  const create = (
    options: {
      projectExists?: boolean;
      recordFails?: boolean;
      neverOnline?: boolean;
    } = {},
  ) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
      .with({ provide: ScalewayProvider, use: FixedTempScaleway });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const shell = alepha.inject(MemoryShellProvider);
    const fs = alepha.inject(MemoryFileSystemProvider);
    shell.configure({
      installedCommands: ["scw"],
      outputs: {
        "scw info -o json": JSON.stringify({
          build_info: {},
          settings: [{ key: "secret_key", value: "c381a8bf-xxxx" }],
        }),
        "scw instance server-type list zone=fr-par-1 -o json": JSON.stringify([
          { name: "DEV1-S", hourly_price: { units: 0, nanos: 8_976_000 } },
        ]),
        "scw instance ip create zone=fr-par-1 tags.0=lore tags.1=tmp-vps -o json":
          JSON.stringify({ ip: { id: "ip-1", address: "203.0.113.10" } }),
        "scw instance server create type=DEV1-S image=ubuntu_noble name=tmp-vps zone=fr-par-1 ip=ip-1 tags.0=lore tags.1=tmp-vps cloud-init=@/tmp/lore-cloud-init-tmp-vps.yaml -o json":
          JSON.stringify({ id: "srv-1" }),
      },
    });

    const calls: Array<{ name: string; request?: unknown }> = [];
    const command = alepha.inject(EstateCommand);
    const provisioner = alepha.inject(LoreEstateProvisioner);
    provisioner.pollMillis = 1;
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: {
          getProjectBySlug: async () =>
            options.projectExists ? { id: 7 } : undefined,
        },
      },
    );
    const estate = { id: "est-1", slug: "tmp-vps", deployAllowed: false };
    let reads = 0;
    Object.assign(provisioner as unknown as Record<string, unknown>, {
      projectApi: {
        getProjectBySlug: async () => {
          if (!options.projectExists) {
            throw new HttpError(
              { status: 404 },
              { message: "Project not found" },
            );
          }
          return {
            id: 7,
            slug: "hello-world",
            capabilities: [{ key: "work" }],
          };
        },
        createProject: async (request: unknown) => {
          calls.push({ name: "createProject", request });
          return { id: 7, slug: "hello-world" };
        },
      },
      lending: {
        createProjectEstate: async (request: unknown) => {
          calls.push({ name: "createProjectEstate", request });
          return estate;
        },
      },
      estates: {
        listMyEstates: async () => ({ items: [] }),
        createEstate: async (request: unknown) => {
          calls.push({ name: "createEstate", request });
          return estate;
        },
        updateEstate: async (request: unknown) => {
          calls.push({ name: "updateEstate", request });
          return { ...estate, deployAllowed: true };
        },
        createEstateEnrolment: async () => {
          calls.push({ name: "createEstateEnrolment" });
          return { secret: "enr_abc", expiresAt: "2026-11-06T23:00:00Z" };
        },
        recordEstateProvision: async (request: unknown) => {
          calls.push({ name: "recordEstateProvision", request });
          if (options.recordFails) {
            throw new Error("Lore is down");
          }
          return estate;
        },
        getEstate: async () => {
          reads++;
          return { ...estate, online: !options.neverOnline && reads > 1 };
        },
        deleteEstate: async (request: unknown) => {
          calls.push({ name: "deleteEstate", request });
          return { ok: true };
        },
      },
    });
    const run = async (argv: string) => {
      await alepha.inject(CliProvider).run(command.provision as never, {
        argv,
      });
    };
    return { run, printed, calls, shell, fs };
  };

  it("lists the providers and what each needs when --provider is missing, and creates nothing", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await expect(run("")).rejects.toThrow("scw login");
    expect(calls).toEqual([]);
  });

  it("creates the project, lends the estate, enrols the server with a one-time secret and waits until it is online", async ({
    expect,
  }) => {
    const { run, printed, calls, fs } = create();
    await run("--provider scaleway --name tmp-vps --project hello-world");

    expect(calls.map((call) => call.name)).toEqual([
      "createProject",
      "createProjectEstate",
      "updateEstate",
      "createEstateEnrolment",
      "recordEstateProvision",
    ]);
    expect(calls[2]!.request).toEqual({
      params: { estateId: "est-1" },
      body: { deployAllowed: true },
    });
    expect(calls[4]!.request).toEqual({
      params: { estateId: "est-1" },
      body: {
        provider: "scaleway",
        serverId: "srv-1",
        type: "DEV1-S",
        zone: "fr-par-1",
        hourlyPrice: 0.008976,
      },
    });
    // The cloud-init enrols with the one-time secret, under the server's
    // own sslip.io domain.
    expect(
      fs.wasWrittenMatching(
        "/tmp/lore-cloud-init-tmp-vps.yaml",
        /LORE_ESTATE_SECRET=enr_abc BAY_BASE_DOMAIN=203-0-113-10\.sslip\.io/,
      ),
    ).toBe(true);
    const out = printed.join("\n");
    expect(out).toContain("Created project hello-world.");
    expect(out).toContain("tmp-vps is online.");
    expect(out).toContain("https://<app>.203-0-113-10.sslip.io");
    expect(out).toContain("alepha deploy");
    expect(out).toContain("lore estate delete tmp-vps --yes");
  });

  it("needs no project, and says how to lend the estate later", async ({
    expect,
  }) => {
    const { run, printed, calls } = create();
    await run("--provider scaleway --name tmp-vps --no-allow-deploys");
    expect(calls.map((call) => call.name)).toEqual([
      "createEstate",
      "createEstateEnrolment",
      "recordEstateProvision",
    ]);
    expect(printed.join("\n")).toContain(
      "lore estate lend tmp-vps --project <project>",
    );
  });

  it("terminates the server and deletes the estate when a step after the create fails", async ({
    expect,
  }) => {
    const { run, calls, shell } = create({ recordFails: true });
    await expect(run("--provider scaleway --name tmp-vps")).rejects.toThrow(
      "Lore is down",
    );
    expect(
      shell.wasCalled(
        "scw instance server terminate srv-1 zone=fr-par-1 with-ip=true with-block=true",
      ),
    ).toBe(true);
    expect(calls.at(-1)!.name).toBe("deleteEstate");
  });

  it("keeps the server and the estate when it never comes online, and says how to go on", async ({
    expect,
  }) => {
    const { run, calls } = create({ neverOnline: true });
    await expect(
      run("--provider scaleway --name tmp-vps --timeout 1"),
    ).rejects.toThrow("srv-1 is kept and still billing");
    expect(calls.map((call) => call.name)).not.toContain("deleteEstate");
  });

  it("says so when --project names an existing project, and that it cannot deploy without Apps", async ({
    expect,
  }) => {
    const { run, printed, calls } = create({ projectExists: true });
    await run("--provider scaleway --name tmp-vps --project hello-world");
    expect(calls.map((call) => call.name)).not.toContain("createProject");
    const out = printed.join("\n");
    expect(out).toContain("Lending it to your existing project hello-world.");
    expect(out).toContain(
      "lore project capability enable apps --option deploy -p hello-world",
    );
  });
});

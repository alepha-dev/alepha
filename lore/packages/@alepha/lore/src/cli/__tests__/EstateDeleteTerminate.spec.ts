import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { EstateCommand } from "../commands/EstateCommand.ts";
import { LoreEstateResolver } from "../services/LoreEstateResolver.ts";

/**
 * `lore estate delete` on a provisioned estate (#Q3167): the server goes
 * with its IP and its disk, through the user's own scw, after Lore said it
 * would accept the delete and before the row goes; a terminate that fails
 * keeps the row.
 */
describe("lore estate delete, provisioned", () => {
  const terminateCall =
    "scw instance server terminate srv-1 zone=fr-par-1 with-ip=true with-block=true";

  const create = (options: { referenced?: boolean } = {}) => {
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
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const shell = alepha.inject(MemoryShellProvider);
    shell.configure({
      installedCommands: ["scw"],
      outputs: {
        "scw info -o json": JSON.stringify([
          { key: "secret_key", value: "c381a8bf-xxxx" },
        ]),
      },
    });
    const calls: string[] = [];
    const estates = {
      listMyEstates: async () => ({
        items: [
          {
            id: "e1",
            slug: "small-skilled-pie",
            type: "bay",
            provider: "scaleway",
            providerServerId: "srv-1",
            providerZone: "fr-par-1",
          },
        ],
      }),
      checkEstateDeletable: async () => {
        calls.push("check");
        if (options.referenced) {
          throw new Error("hello/production still deploys to this estate");
        }
        return { ok: true };
      },
      deleteEstate: async () => {
        calls.push("delete");
        return { ok: true };
      },
    };
    const command = alepha.inject(EstateCommand);
    Object.assign(
      alepha.inject(LoreEstateResolver) as unknown as Record<string, unknown>,
      { estates },
    );
    Object.assign(command as unknown as Record<string, unknown>, { estates });
    const run = async (argv: string) => {
      await alepha.inject(CliProvider).run(command.delete as never, { argv });
    };
    return { run, printed, calls, shell };
  };

  it("checks, terminates the server with its IP and disk, then deletes the estate", async ({
    expect,
  }) => {
    const { run, printed, calls, shell } = create();
    await run("small-skilled-pie --yes");
    expect(calls).toEqual(["check", "delete"]);
    expect(shell.wasCalled(terminateCall)).toBe(true);
    expect(printed.join("\n")).toContain(
      "terminated its server srv-1, with its IP and its disk",
    );
  });

  it("terminates nothing when Lore would refuse the delete", async ({
    expect,
  }) => {
    const { run, calls, shell } = create({ referenced: true });
    await expect(run("small-skilled-pie --yes")).rejects.toThrow(
      "still deploys",
    );
    expect(shell.wasCalled(terminateCall)).toBe(false);
    expect(calls).toEqual(["check"]);
  });

  it("keeps the estate and prints the command that finishes when the terminate fails", async ({
    expect,
  }) => {
    const { run, calls, shell } = create();
    shell.errors.set(terminateCall, "server is locked");
    await expect(run("small-skilled-pie --yes")).rejects.toThrow(
      "lore estate delete small-skilled-pie --keep-server --yes",
    );
    expect(calls).toEqual(["check"]);
  });

  it("--keep-server deletes the estate only, and says the server still bills", async ({
    expect,
  }) => {
    const { run, printed, calls, shell } = create();
    await run("small-skilled-pie --yes --keep-server");
    expect(calls).toEqual(["delete"]);
    expect(shell.wasCalled(terminateCall)).toBe(false);
    expect(printed.join("\n")).toContain(
      "still running on scaleway, and billing",
    );
  });
});

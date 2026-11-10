import { Alepha } from "alepha";
import { vendorOptions } from "alepha/cli/vendor";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { TypecheckCommand } from "../typecheck.ts";

/**
 * `typecheck` runs oxlint with a config it generates, so the project's own
 * `ignorePatterns` never reach it: everything it skips is on its command line.
 */
describe("TypecheckCommand", () => {
  const argv = async (vendor?: { packages: string[]; dir?: string }) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    if (vendor) {
      alepha.store.set(vendorOptions, vendor);
    }

    const cli = alepha.inject(CliProvider);
    const typecheck = alepha.inject(TypecheckCommand);
    const shell = alepha.inject(MemoryShellProvider);

    await cli.run(typecheck.typecheck, { argv: "", root: "/app" });
    return shell.calls.map((it) => it.command).join("\n");
  };

  it("skips node_modules only, in a project that vendors nothing", async () => {
    const command = await argv();

    expect(command).toContain("--type-check");
    expect(command).toContain('--ignore-pattern "node_modules"');
    expect(command).not.toContain(".vendor");
  });

  it("skips the vendored packages, whose own configs only resolve upstream (#Q3310)", async () => {
    const command = await argv({ packages: ["alepha"] });

    expect(command).toContain('--ignore-pattern ".vendor/**"');
  });

  it("follows a vendor directory moved by the config", async () => {
    const command = await argv({ packages: ["alepha"], dir: "third_party" });

    expect(command).toContain('--ignore-pattern "third_party/**"');
    expect(command).not.toContain(".vendor");
  });
});

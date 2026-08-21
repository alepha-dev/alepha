import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";

import { FileSystemProvider } from "../providers/FileSystemProvider.ts";
import { MemoryFileSystemProvider } from "../providers/MemoryFileSystemProvider.ts";
import { NodeShellProvider } from "../providers/NodeShellProvider.ts";

/**
 * `resolveExecutable` only ever touches the filesystem through the injected
 * `FileSystemProvider`, so the whole search order is testable against the
 * memory provider — no real node_modules required.
 */
class TestShellProvider extends NodeShellProvider {
  public testResolveExecutable = this.resolveExecutable.bind(this);
  public testLocalBinPath = this.localBinPath.bind(this);
}

describe("NodeShellProvider.resolveExecutable", () => {
  let shell: TestShellProvider;
  let fs: MemoryFileSystemProvider;

  beforeEach(() => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    shell = alepha.inject(TestShellProvider);
    fs = alepha.inject(MemoryFileSystemProvider);
  });

  it("finds a binary in the local node_modules/.bin", async () => {
    await fs.writeFile("/proj/node_modules/.bin/vite", "#!/bin/sh");

    await expect(shell.testResolveExecutable("vite", "/proj")).resolves.toBe(
      "/proj/node_modules/.bin/vite",
    );
  });

  it("falls back to the pnpm-nested location", async () => {
    await fs.writeFile(
      "/proj/node_modules/alepha/node_modules/.bin/tsdown",
      "#!/bin/sh",
    );

    await expect(shell.testResolveExecutable("tsdown", "/proj")).resolves.toBe(
      "/proj/node_modules/alepha/node_modules/.bin/tsdown",
    );
  });

  it("walks up to a monorepo root", async () => {
    await fs.writeFile("/repo/node_modules/.bin/alepha", "#!/bin/sh");

    await expect(
      shell.testResolveExecutable("alepha", "/repo/apps/web"),
    ).resolves.toBe("/repo/node_modules/.bin/alepha");
  });

  it("throws a clear error when the binary is nowhere", async () => {
    await expect(
      shell.testResolveExecutable("missing-bin", "/proj"),
    ).rejects.toThrow(/Could not find executable for 'missing-bin'/);
  });
});

describe("NodeShellProvider.localBinPath", () => {
  it("prefixes the project bin directories before the inherited PATH", () => {
    const shell = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .inject(TestShellProvider);

    const path = shell.testLocalBinPath("/proj");
    const entries = path.split(process.platform === "win32" ? ";" : ":");

    expect(entries[0]).toBe("/proj/node_modules/.bin");
    expect(entries[1]).toBe("/proj/node_modules/alepha/node_modules/.bin");
    // The inherited PATH survives at the end.
    expect(path.endsWith(process.env.PATH ?? "")).toBe(true);
  });
});

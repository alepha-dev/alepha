import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { PackCommand } from "../commands/pack.ts";

describe("PackCommand", () => {
  const create = async (packageName: string) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    await fs.writeFile(
      "/app/package.json",
      JSON.stringify({ name: packageName }),
    );
    await fs.mkdir("/app/dist", { recursive: true });
    await fs.writeFile("/app/dist/manifest.json", "{}");

    return {
      cli: alepha.inject(CliProvider),
      pack: alepha.inject(PackCommand),
      shell: alepha.inject(MemoryShellProvider),
    };
  };

  it("should slugify a scoped package name", async () => {
    // `@acme/app-latest.tar.gz` puts a path separator in the archive name, so
    // tar targeted a directory that does not exist and the command failed.
    const { cli, pack, shell } = await create("@acme/app");

    await cli.run(pack.pack, { argv: "", root: "/app" });

    const commands = shell.calls.map((it) => it.command).join("\n");
    expect(commands).toContain("acme-app-latest.tar.gz");
    expect(commands).not.toContain("@acme/app-latest.tar.gz");
  });

  it("should leave an unscoped name readable", async () => {
    const { cli, pack, shell } = await create("my-app");

    await cli.run(pack.pack, { argv: "", root: "/app" });

    expect(shell.calls.map((it) => it.command).join("\n")).toContain(
      "my-app-latest.tar.gz",
    );
  });

  it("should take --name over package.json", async () => {
    // What a platform deploy passes: `platform({ name })` is the identity the
    // deploy side knows the app by, and it is free to differ from the package
    // name. Without this flag `pack` wrote one filename and the caller looked
    // for another.
    const { cli, pack, shell } = await create("app");

    await cli.run(pack.pack, { argv: "--name capacity", root: "/app" });

    const commands = shell.calls.map((it) => it.command).join("\n");
    expect(commands).toContain("capacity-latest.tar.gz");
    expect(commands).not.toContain("app-latest.tar.gz");
  });

  it("should keep --name verbatim, so the caller can predict the filename", async () => {
    // The package-name default is slugified; an explicit name is not, or the
    // caller that passed `app.v2` would again be looking for the wrong file.
    const { cli, pack, shell } = await create("app");

    await cli.run(pack.pack, { argv: "--name app.v2", root: "/app" });

    expect(shell.calls.map((it) => it.command).join("\n")).toContain(
      "app.v2-latest.tar.gz",
    );
  });

  it("should refuse a --name that is not a filename", async () => {
    // Taken verbatim into a path, so a separator or a parent reference would
    // write outside the output directory.
    const { cli, pack } = await create("app");

    await expect(
      cli.run(pack.pack, { argv: "--name ../../etc/cron.d/x", root: "/app" }),
    ).rejects.toThrowError(/Invalid --name/);
  });
});

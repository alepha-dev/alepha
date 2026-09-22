import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { LinkProvider } from "alepha/server/links";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { ReleaseCommand } from "../commands/ReleaseCommand.ts";

/**
 * `lore releases changelog` and `lore releases cut`: the release job's notes
 * and its local version bump, both from the open Lore release carrying the
 * version.
 *
 * Both are LOUD where `publish` is quiet: a job that cannot get its notes
 * must stop before it tags anything, so a missing or published release is an
 * error here, and `cut` checks everything before its first write.
 */
class FakeLinkProvider extends LinkProvider {
  public releases: Array<{ id: number; tag: string; releasedAt?: string }> = [];
  public changelogs = new Map<number, string>();

  override client(): any {
    return {
      getProjectBySlug: async (config: any) => ({
        id: 7,
        slug: config.params.slug,
      }),
      getReleases: async () => this.releases,
      getReleaseChangelog: async (config: any) => ({
        markdown: this.changelogs.get(config.params.id) ?? "",
      }),
    };
  }
}

const LORE_CHANGELOG = [
  "# Release 0.2.0",
  "",
  "## Features",
  "",
  "- the planning opens on the now line",
  "",
  "### Details",
  "",
  "- a recurring series is written in full",
].join("\n");

const NOTES = [
  "### Features",
  "",
  "- the planning opens on the now line",
  "",
  "#### Details",
  "",
  "- a recurring series is written in full",
].join("\n");

describe("lore releases changelog and cut", () => {
  const setup = async (version = "0.1.0") => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "lore_secret",
        LORE_PROJECT: "club",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
      .with(ReleaseCommand);

    const fs = alepha.inject(MemoryFileSystemProvider);
    await fs.writeFile(
      "/app/package.json",
      `${JSON.stringify({ name: "club", version, private: true }, null, 2)}\n`,
    );

    const links = alepha.inject(FakeLinkProvider) as FakeLinkProvider;
    links.releases = [
      { id: 1, tag: "0.1.0", releasedAt: "2026-09-01T00:00:00.000Z" },
      { id: 2, tag: "0.2.0" },
    ];
    links.changelogs.set(2, LORE_CHANGELOG);

    // No tag exists yet: a failing `rev-parse --verify` is how git says so,
    // and MemoryShellProvider answers 0 to every command it is not told to fail.
    const shell = alepha.inject(MemoryShellProvider);
    for (const tag of ["0.1.0", "0.2.0", "0.3.0"]) {
      shell.errors.set(`git rev-parse -q --verify refs/tags/${tag}`, "no tag");
    }

    return {
      cli: alepha.inject(CliProvider),
      command: alepha.inject(ReleaseCommand),
      fs,
      links,
      shell: alepha.inject(MemoryShellProvider),
      output: alepha.inject(MemoryOutputProvider),
    };
  };

  const commands = (ctx: Awaited<ReturnType<typeof setup>>) =>
    ctx.shell.calls.map((it) => it.command);

  describe("changelog", () => {
    it("prints the open release's notes, title dropped and headings one level down", async () => {
      const ctx = await setup();

      await ctx.cli.run(ctx.command.changelog, { argv: "--tag 0.2.0" });

      expect(ctx.output.text.trim()).toBe(NOTES);
    });

    it("refuses a tag no release carries", async () => {
      const ctx = await setup();

      await expect(
        ctx.cli.run(ctx.command.changelog, { argv: "--tag 0.9.0" }),
      ).rejects.toThrow(/No release tagged 0.9.0/);
    });

    it("refuses a release already published", async () => {
      const ctx = await setup();

      await expect(
        ctx.cli.run(ctx.command.changelog, { argv: "--tag 0.1.0" }),
      ).rejects.toThrow(/already published/);
    });
  });

  describe("cut", () => {
    it("bumps package.json, prepends CHANGELOG.md, commits and tags, locally", async () => {
      const ctx = await setup();
      await ctx.fs.writeFile(
        "/app/CHANGELOG.md",
        "## [0.1.0] - 2026-09-01\n\nOld.\n",
      );

      await ctx.cli.run(ctx.command.cut, {
        argv: "--bump minor",
        root: "/app",
      });

      const pkg = JSON.parse(await ctx.fs.readTextFile("/app/package.json"));
      expect(pkg).toEqual({ name: "club", version: "0.2.0", private: true });

      const changelog = await ctx.fs.readTextFile("/app/CHANGELOG.md");
      expect(changelog).toMatch(
        /^## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}\n\n### Features\n/,
      );
      expect(changelog).toContain(
        `${NOTES}\n\n## [0.1.0] - 2026-09-01\n\nOld.\n`,
      );

      expect(commands(ctx)).toEqual([
        "git rev-parse -q --verify refs/tags/0.2.0",
        "git add package.json CHANGELOG.md",
        "git commit -m release: 0.2.0",
        "git tag -a 0.2.0 -m release: 0.2.0",
      ]);
      expect(commands(ctx).some((it) => it.includes("push"))).toBe(false);
    });

    it("writes the notes and VERSION to the files it is given", async () => {
      const ctx = await setup();

      await ctx.cli.run(ctx.command.cut, {
        argv: "--bump minor --notes /tmp/notes.md --env-file /tmp/github.env",
        root: "/app",
      });

      expect(await ctx.fs.readTextFile("/tmp/notes.md")).toBe(`${NOTES}\n`);
      expect(await ctx.fs.readTextFile("/tmp/github.env")).toBe(
        "VERSION=0.2.0\n",
      );
    });

    it("starts a CHANGELOG.md when there is none", async () => {
      const ctx = await setup();

      await ctx.cli.run(ctx.command.cut, {
        argv: "--bump minor",
        root: "/app",
      });

      const changelog = await ctx.fs.readTextFile("/app/CHANGELOG.md");
      expect(changelog.endsWith(`${NOTES}\n\n`)).toBe(true);
    });

    it("bumps each position, resetting the ones below", async () => {
      const { command: cmd } = await setup();
      expect(cmd.nextVersion("1.4.7", "major")).toBe("2.0.0");
      expect(cmd.nextVersion("1.4.7", "minor")).toBe("1.5.0");
      expect(cmd.nextVersion("1.4.7", "patch")).toBe("1.4.8");
    });

    it("writes nothing when the release is already published", async () => {
      const ctx = await setup("0.0.0");

      await expect(
        ctx.cli.run(ctx.command.cut, { argv: "--bump minor", root: "/app" }),
      ).rejects.toThrow(/0.1.0 in club was already published/);

      const pkg = JSON.parse(await ctx.fs.readTextFile("/app/package.json"));
      expect(pkg.version).toBe("0.0.0");
      expect(await ctx.fs.exists("/app/CHANGELOG.md")).toBe(false);
    });

    it("refuses an existing git tag before asking Lore", async () => {
      const ctx = await setup();
      ctx.shell.errors.delete("git rev-parse -q --verify refs/tags/0.2.0");
      await expect(
        ctx.cli.run(ctx.command.cut, { argv: "--bump minor", root: "/app" }),
      ).rejects.toThrow(/Tag 0.2.0 already exists/);

      expect(commands(ctx)).toEqual([
        "git rev-parse -q --verify refs/tags/0.2.0",
      ]);
    });

    it("writes nothing when the release is not open", async () => {
      const ctx = await setup("0.2.0");

      await expect(
        ctx.cli.run(ctx.command.cut, { argv: "--bump minor", root: "/app" }),
      ).rejects.toThrow(/No release tagged 0.3.0/);

      const pkg = JSON.parse(await ctx.fs.readTextFile("/app/package.json"));
      expect(pkg.version).toBe("0.2.0");
    });

    it("refuses a version that is not a plain x.y.z", async () => {
      const ctx = await setup("0.2.0-rc.1");

      await expect(
        ctx.cli.run(ctx.command.cut, { argv: "--bump minor", root: "/app" }),
      ).rejects.toThrow(/not a plain x.y.z/);
    });
  });
});

import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
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
 * `lore releases publish`: find the release carrying the tag, publish
 * it, and stay quiet when there is nothing to do.
 *
 * The three outcomes are asserted on what reaches the server, because the
 * two silent ones are the design: a job that goes red because nobody created
 * a Lore release for this version, or because the previous run already
 * published it, blocks nothing useful and reads as a failed release. The
 * guards themselves (`quest:create` and the owner gate) are exercised against
 * the real Lore app in `apps/lore/test/release-cli-publish.spec.ts`.
 */
class FakeLinkProvider extends LinkProvider {
  public releases: Array<{ id: number; tag: string; releasedAt?: string }> = [];
  public published: number[] = [];
  public slugLookups: string[] = [];
  public listCalls = 0;

  override client(): any {
    return {
      getProjectBySlug: async (config: any) => {
        this.slugLookups.push(config.params.slug);
        return { id: 7, slug: config.params.slug };
      },
      getReleases: async () => {
        this.listCalls += 1;
        return this.releases;
      },
      publishRelease: async (config: any) => {
        this.published.push(config.params.id);
        const release = this.releases.find((it) => it.id === config.params.id);
        return { ...release, releasedAt: "2026-09-02T12:00:00.000Z" };
      },
    };
  }
}

describe("lore releases publish", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "lore_secret",
        LORE_PROJECT: "alepha",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(ReleaseCommand);

    return {
      alepha,
      cli: alepha.inject(CliProvider),
      command: alepha.inject(ReleaseCommand),
      links: alepha.inject(FakeLinkProvider) as FakeLinkProvider,
    };
  };

  it("publishes the release carrying the tag, by its id", async () => {
    const ctx = await setup();
    ctx.links.releases = [
      { id: 41, tag: "0.27.0", releasedAt: "2026-08-01T00:00:00.000Z" },
      { id: 42, tag: "0.28.0" },
      { id: 43, tag: "0.29.0" },
    ];

    await ctx.cli.run(ctx.command.publish, { argv: "--tag 0.28.0" });

    expect(ctx.links.slugLookups).toEqual(["alepha"]);
    expect(ctx.links.published).toEqual([42]);
  });

  /**
   * Byte for byte, the way `releaseTagSchema` keeps it and `artifacts.tag`
   * joins on it: `v2-rc1` is not `V2-RC1`.
   */
  it("matches the tag case-sensitively", async () => {
    const ctx = await setup();
    ctx.links.releases = [{ id: 42, tag: "V2-RC1" }];

    await ctx.cli.run(ctx.command.publish, { argv: "--tag v2-rc1" });

    expect(ctx.links.published).toEqual([]);
  });

  /**
   * A planning fact, not a build fact: the job exits 0 and says so.
   */
  it("exits cleanly when no release carries the tag", async () => {
    const ctx = await setup();
    ctx.links.releases = [{ id: 42, tag: "0.28.0" }];

    await expect(
      ctx.cli.run(ctx.command.publish, { argv: "--tag 0.30.0" }),
    ).resolves.not.toThrow();

    expect(ctx.links.listCalls).toBe(1);
    expect(ctx.links.published).toEqual([]);
  });

  /**
   * What makes a re-run of the release job safe.
   */
  it("exits cleanly when the release is already published", async () => {
    const ctx = await setup();
    ctx.links.releases = [
      { id: 42, tag: "0.28.0", releasedAt: "2026-09-01T10:00:00.000Z" },
    ];

    await expect(
      ctx.cli.run(ctx.command.publish, { argv: "--tag 0.28.0" }),
    ).resolves.not.toThrow();

    expect(ctx.links.published).toEqual([]);
  });

  it("takes --project over the configured one", async () => {
    const ctx = await setup();
    ctx.links.releases = [{ id: 42, tag: "0.28.0" }];

    await ctx.cli.run(ctx.command.publish, {
      argv: "--tag 0.28.0 --project other",
    });

    expect(ctx.links.slugLookups).toEqual(["other"]);
    expect(ctx.links.published).toEqual([42]);
  });
});

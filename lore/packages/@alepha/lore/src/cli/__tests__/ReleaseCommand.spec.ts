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
interface FakeRelease {
  id: number;
  tag: string;
  releasedAt?: string;
  progress?: { completed: number; total: number };
}

class FakeLinkProvider extends LinkProvider {
  public releases: FakeRelease[] = [];
  public contents: { epics: any[]; looseQuests: any[] } = {
    epics: [],
    looseQuests: [],
  };
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
        return this.releases.map((it) => ({
          progress: { completed: 0, total: 0 },
          ...it,
        }));
      },
      getReleaseContents: async () => this.contents,
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

/**
 * The completeness gate (#Q2600): Alepha 0.31.0 shipped at 47/66 because no
 * command read `progress`. `check` runs before anything irreversible; the
 * same refusal backs `publish`, `cut` and `changelog`.
 */
describe("lore releases check", () => {
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
      cli: alepha.inject(CliProvider),
      command: alepha.inject(ReleaseCommand),
      links: alepha.inject(FakeLinkProvider) as FakeLinkProvider,
    };
  };

  const incomplete = (links: FakeLinkProvider) => {
    links.releases = [
      { id: 42, tag: "0.31.0", progress: { completed: 2, total: 4 } },
    ];
    links.contents = {
      epics: [
        {
          number: 9,
          title: "Deploy v2",
          completed: 1,
          total: 2,
          quests: [
            { shortId: 10, title: "Done", completedAt: "2026-10-01" },
            { shortId: 11, title: "Rollback", acceptedAt: "2026-10-01" },
            { shortId: 12, title: "Declined", shelvedAt: "2026-10-01" },
          ],
        },
        {
          number: 10,
          title: "Finished",
          completed: 1,
          total: 1,
          quests: [
            { shortId: 13, title: "Shipped", completedAt: "2026-10-01" },
          ],
        },
      ],
      looseQuests: [
        { shortId: 14, title: "Docs", completedAt: "2026-10-01" },
        { shortId: 15, title: "Changelog wording" },
      ],
    };
  };

  it("passes a release whose quests are all completed", async () => {
    const ctx = await setup();
    ctx.links.releases = [
      { id: 42, tag: "0.31.0", progress: { completed: 4, total: 4 } },
    ];

    await expect(
      ctx.cli.run(ctx.command.check, { argv: "--tag 0.31.0" }),
    ).resolves.not.toThrow();
  });

  it("refuses an incomplete release, naming each unfinished epic and quest", async () => {
    const ctx = await setup();
    incomplete(ctx.links);

    const run = ctx.cli.run(ctx.command.check, { argv: "--tag 0.31.0" });

    await expect(run).rejects.toThrow("is 2/4 complete");
    const message = await run.catch((error: unknown) =>
      error instanceof Error ? error.message : "",
    );
    expect(message).toContain("#E9 Deploy v2: 1/2");
    expect(message).toContain("#Q11 Rollback (in progress)");
    expect(message).toContain("#Q15 Changelog wording (todo)");
    // Done and shelved quests, and an epic with nothing left, are not listed.
    expect(message).not.toContain("#Q10");
    expect(message).not.toContain("#Q12");
    expect(message).not.toContain("#E10");
  });

  /**
   * Shelved quests sit outside `total`, so a release whose only remainder is
   * declined work counts as complete.
   */
  it("passes a release whose remainder is only shelved", async () => {
    const ctx = await setup();
    ctx.links.releases = [
      { id: 42, tag: "0.31.0", progress: { completed: 3, total: 3 } },
    ];

    await expect(
      ctx.cli.run(ctx.command.check, { argv: "--tag 0.31.0" }),
    ).resolves.not.toThrow();
  });

  it("exits cleanly for an already-published release, whatever its progress", async () => {
    const ctx = await setup();
    ctx.links.releases = [
      {
        id: 42,
        tag: "0.31.0",
        releasedAt: "2026-10-01T00:00:00.000Z",
        progress: { completed: 1, total: 4 },
      },
    ];

    await expect(
      ctx.cli.run(ctx.command.check, { argv: "--tag 0.31.0" }),
    ).resolves.not.toThrow();
  });

  it("exits cleanly when no release carries the tag", async () => {
    const ctx = await setup();
    incomplete(ctx.links);

    await expect(
      ctx.cli.run(ctx.command.check, { argv: "--tag 0.32.0" }),
    ).resolves.not.toThrow();
  });

  it("publish refuses an incomplete release and publishes nothing", async () => {
    const ctx = await setup();
    incomplete(ctx.links);

    await expect(
      ctx.cli.run(ctx.command.publish, { argv: "--tag 0.31.0" }),
    ).rejects.toThrow("is 2/4 complete");
    expect(ctx.links.published).toEqual([]);
  });

  it("changelog refuses an incomplete release", async () => {
    const ctx = await setup();
    incomplete(ctx.links);

    await expect(
      ctx.cli.run(ctx.command.changelog, { argv: "--tag 0.31.0" }),
    ).rejects.toThrow("is 2/4 complete");
  });
});

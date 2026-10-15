import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { BuildFreshness } from "../BuildFreshness.ts";

/**
 * `alepha build --if-stale` decides whether to build at all, so every case
 * here asks the one question that matters: can a build that is NOT current
 * ever read as current. A false "fresh" is a suite passing against the
 * previous bundle - green, and testing nothing.
 *
 * Ordering is driven by `DateTimeProvider.travel()` rather than by real
 * clock, since `MemoryFileSystemProvider` stamps mtimes from it: a test then
 * states the ordering it means instead of depending on how fast it runs.
 */
describe("BuildFreshness", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with(AlephaDateTime)
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    const clock = alepha.inject(DateTimeProvider);
    const freshness = alepha.inject(BuildFreshness);
    await alepha.start();
    clock.pause();
    return { fs, clock, freshness };
  };

  /**
   * An app with one workspace dependency it bundles, built after its sources.
   *
   * ⚠️ The dependency is placed in the REPO ROOT's `node_modules`, not the
   * app's, because that is where yarn hoists a workspace symlink. An earlier
   * version of this scaffold put it under `/repo/app/node_modules` and so
   * agreed with a bug that resolved deps against the app alone: every test
   * passed while the real check reported a fresh build after the whole
   * framework had changed.
   */
  const scaffold = async (
    fs: MemoryFileSystemProvider,
    clock: DateTimeProvider,
  ) => {
    await fs.writeFile(
      "/repo/app/package.json",
      JSON.stringify({ dependencies: { lib: "workspace:*" } }),
    );
    await fs.writeFile("/repo/app/src/main.ts", "app");
    await fs.writeFile(
      "/repo/node_modules/lib/package.json",
      JSON.stringify({ name: "lib" }),
    );
    await fs.writeFile("/repo/node_modules/lib/src/index.ts", "lib");
    await clock.travel(60_000);
    await fs.writeFile(
      "/repo/app/dist/manifest.json",
      JSON.stringify({
        manifestVersion: 2,
        project: "fixture",
        runtimes: [{ runtime: "bun", entry: "index.bun.js" }],
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
          hasWebSocket: false,
        },
        crons: [],
        secrets: [],
        variables: [],
      }),
    );
  };

  it("says a missing build is missing, rather than calling it fresh", async ({
    expect,
  }) => {
    const { fs, freshness } = await setup();
    await fs.writeFile("/repo/app/package.json", "{}");
    await fs.writeFile("/repo/app/src/main.ts", "app");

    expect(await freshness.staleReason("/repo/app", "dist")).toBe(
      "dist/manifest.json is missing",
    );
  });

  it("is fresh when the build is newer than every input", async ({
    expect,
  }) => {
    const { fs, clock, freshness } = await setup();
    await scaffold(fs, clock);

    expect(await freshness.staleReason("/repo/app", "dist")).toBeNull();
  });

  it("is stale when the app's own source moves", async ({ expect }) => {
    const { fs, clock, freshness } = await setup();
    await scaffold(fs, clock);

    await clock.travel(60_000);
    await fs.writeFile("/repo/app/src/main.ts", "edited");

    expect(await freshness.staleReason("/repo/app", "dist")).toContain(
      "src changed",
    );
  });

  /**
   * The case an existence check cannot see, and the reason this class exists:
   * an app's bundle inlines its workspace dependencies, so editing one leaves
   * a present, stale, wrong `dist`.
   */
  it("is stale when a bundled workspace dependency moves", async ({
    expect,
  }) => {
    const { fs, clock, freshness } = await setup();
    await scaffold(fs, clock);

    await clock.travel(60_000);
    await fs.writeFile("/repo/node_modules/lib/src/index.ts", "edited");

    expect(await freshness.staleReason("/repo/app", "dist")).toContain(
      "node_modules/lib/src changed",
    );
  });

  /**
   * Finding nothing is not evidence that nothing changed.
   */
  it("refuses to call a build fresh when it can read no sources", async ({
    expect,
  }) => {
    const { fs, freshness } = await setup();
    await fs.writeFile(
      "/repo/app/dist/manifest.json",
      JSON.stringify({
        manifestVersion: 2,
        project: "fixture",
        runtimes: [{ runtime: "bun", entry: "index.bun.js" }],
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
          hasWebSocket: false,
        },
        crons: [],
        secrets: [],
        variables: [],
      }),
    );

    expect(await freshness.staleReason("/repo/app", "dist")).toContain(
      "no readable sources",
    );
  });

  /**
   * A build's inputs are not only its sources: the config decides what is
   * built from them. Editing `alepha.config.ts` used to answer "up to date".
   */
  for (const file of [
    "alepha.config.ts",
    "tsconfig.json",
    "tsconfig.build.json",
    ".env",
    ".env.production",
    "vite.config.ts",
    "index.html",
  ]) {
    it(`is stale when ${file} moves`, async ({ expect }) => {
      const { fs, clock, freshness } = await setup();
      await fs.writeFile(`/repo/app/${file}`, "before");
      await scaffold(fs, clock);
      expect(await freshness.staleReason("/repo/app", "dist")).toBeNull();

      await clock.travel(60_000);
      await fs.writeFile(`/repo/app/${file}`, "edited");

      expect(await freshness.staleReason("/repo/app", "dist")).toContain(
        `${file} changed`,
      );
    });
  }

  /**
   * `build --runtime bun --if-stale` after a node build answered "up to
   * date": the runtimes live in no file. The manifest now records a hash of
   * the resolved options, and a different one is stale.
   */
  it("compares the hash of the resolved build options in the manifest", async ({
    expect,
  }) => {
    const { fs, clock, freshness } = await setup();
    await scaffold(fs, clock);
    const node = freshness.optionsHash({ runtime: "node", runtimes: ["node"] });
    const bun = freshness.optionsHash({ runtime: "bun", runtimes: ["bun"] });
    await fs.writeFile(
      "/repo/app/dist/manifest.json",
      JSON.stringify({
        manifestVersion: 2,
        project: "fixture",
        runtimes: [{ runtime: "bun", entry: "index.bun.js" }],
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
          hasWebSocket: false,
        },
        crons: [],
        secrets: [],
        variables: [],
        optionsHash: node,
      }),
    );

    expect(await freshness.staleReason("/repo/app", "dist", node)).toBeNull();
    expect(await freshness.staleReason("/repo/app", "dist", bun)).toContain(
      "build options changed",
    );
  });

  it("keeps the declared order of the runtimes in the hash, and inspect", async ({
    expect,
  }) => {
    const { freshness } = await setup();
    const nodeFirst = freshness.optionsHash({
      runtime: "node",
      runtimes: ["node", "workerd"],
    });
    const workerdFirst = freshness.optionsHash({
      runtime: "workerd",
      runtimes: ["workerd", "node"],
    });
    const inspected = freshness.optionsHash({
      runtime: "node",
      runtimes: ["node", "workerd"],
      inspect: true,
    });

    expect(nodeFirst).not.toBe(workerdFirst);
    expect(nodeFirst).not.toBe(inspected);
  });

  it("calls a manifest from before the hash existed stale", async ({
    expect,
  }) => {
    const { fs, clock, freshness } = await setup();
    await scaffold(fs, clock);

    expect(
      await freshness.staleReason(
        "/repo/app",
        "dist",
        freshness.optionsHash({ runtime: "node", runtimes: ["node"] }),
      ),
    ).toContain("build options changed");
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { afterAll, describe, it } from "vitest";

import { PlatformCommand } from "../../platform/commands/platform.ts";
import {
  type BuildManifest,
  buildManifestSchema,
} from "../schemas/buildManifest.ts";
import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";

/**
 * `dist/manifest.json` validated on both sides of the artifact contract
 * (quest #238).
 *
 * The manifest is written by `alepha build` and read by a deployer that has no
 * access to the build, so nothing between the two can say a field is wrong.
 * These cases pin the three judgements that makes: what is refused, what is
 * carried through untouched, and where a refusal is a fallback rather than a
 * failure.
 */
describe("the build manifest schema", () => {
  /**
   * The smallest manifest that satisfies every required field, so a case can
   * say what it is about by overriding one key.
   */
  const valid = (): Record<string, unknown> => ({
    project: "my-app",
    runtimes: [{ runtime: "node", entry: "index.node.js" }],
    resources: {
      hasDatabase: true,
      hasBucket: false,
      hasAnalytics: false,
      hasKV: false,
      hasQueue: false,
      hasCron: false,
      hasWebSocket: false,
    },
    crons: [],
    secrets: [{ name: "APP_SECRET" }],
    variables: [],
  });

  describe("what it refuses", () => {
    /**
     * ⚠️ The defect the quest was filed for. `{}` is what `PackCommand.spec.ts`
     * writes as a manifest, and it used to sail through `readManifest`'s
     * `try/catch` — which only ever covered an unreadable or unparseable file.
     * `resources` then reached a deployer as `undefined` typed
     * `DetectedResources`, so every `hasX` read `undefined` and a deploy
     * provisioned nothing while reporting success.
     */
    it("refuses an empty object", ({ expect }) => {
      expect(buildManifestSchema.safeParse({}).success).toBe(false);
    });

    it("refuses a manifest with no resources", ({ expect }) => {
      const manifest = valid();
      delete manifest.resources;
      expect(buildManifestSchema.safeParse(manifest).success).toBe(false);
    });

    // A truncated write is the realistic version of the above: a killed build
    // leaves a file that is valid JSON and half a manifest.
    it("refuses a manifest missing one resource flag", ({ expect }) => {
      const manifest = valid();
      delete (manifest.resources as Record<string, unknown>).hasQueue;
      expect(buildManifestSchema.safeParse(manifest).success).toBe(false);
    });

    // `runtimes` is the one field a deployer switches on to decide what to
    // spawn, which is why a static build is a `static` slice.
    it("refuses a runtime it cannot name", ({ expect }) => {
      expect(
        buildManifestSchema.safeParse({
          ...valid(),
          runtimes: [{ runtime: "deno", entry: "index.deno.js" }],
        }).success,
      ).toBe(false);
    });

    // No scalar fallback any more (#Q2460): a manifest that declares no slice
    // tells a deployer nothing, so it is refused rather than read as `node`.
    it("refuses a manifest with no runtimes", ({ expect }) => {
      const manifest = valid();
      delete manifest.runtimes;
      expect(buildManifestSchema.safeParse(manifest).success).toBe(false);
      expect(
        buildManifestSchema.safeParse({ ...valid(), runtimes: [] }).success,
      ).toBe(false);
    });

    it("refuses a manifest with no secrets or variables list", ({ expect }) => {
      const manifest = valid();
      delete manifest.variables;
      expect(buildManifestSchema.safeParse(manifest).success).toBe(false);
    });
  });

  /**
   * The multi-slice contract (epic #E63), with `runtimes` as the only runtime
   * declaration since #Q2460.
   */
  describe("the slices it declares", () => {
    const twoSlices = () => ({
      ...valid(),
      runtimes: [
        { runtime: "node", entry: "index.node.js" },
        { runtime: "workerd", entry: "index.workerd.js" },
      ],
    });

    it("refuses a manifest carrying only the old scalar pair", ({ expect }) => {
      const manifest = valid();
      delete manifest.runtimes;
      expect(
        buildManifestSchema.safeParse({
          ...manifest,
          runtime: "node",
          entry: "index.node.js",
        }).success,
      ).toBe(false);
    });

    /**
     * ⚠️ Declared order is the whole contract: the first slice is the primary,
     * and a deployer takes the first one it can run. A parse that sorted or
     * re-keyed this array would silently change which runtime an app deploys
     * on, which is why the round trip is asserted rather than the membership.
     */
    it("round-trips the slices in declared order", ({ expect }) => {
      const parsed = buildManifestSchema.parse(twoSlices());
      expect(parsed.runtimes?.map((slice) => slice.runtime)).toEqual([
        "node",
        "workerd",
      ]);
      expect(parsed.runtimes?.[0]?.entry).toBe("index.node.js");
    });

    it("keeps bun-first order exactly as declared", ({ expect }) => {
      const parsed = buildManifestSchema.parse({
        ...valid(),
        runtimes: [
          { runtime: "bun", entry: "index.bun.js" },
          { runtime: "node", entry: "index.node.js" },
        ],
      });
      expect(parsed.runtimes.map((slice) => slice.runtime)).toEqual([
        "bun",
        "node",
      ]);
    });

    it("refuses a slice naming a runtime it cannot name", ({ expect }) => {
      const manifest = twoSlices();
      manifest.runtimes[1] = { runtime: "deno", entry: "index.deno.js" } as any;
      expect(buildManifestSchema.safeParse(manifest).success).toBe(false);
    });

    // A static build spawns nothing, so its one slice names no entry.
    it("accepts a static slice with no entry", ({ expect }) => {
      const parsed = buildManifestSchema.parse({
        ...valid(),
        runtimes: [{ runtime: "static" }],
      });
      expect(parsed.runtimes).toEqual([{ runtime: "static" }]);
    });

    // Loose all the way down, for the same reason the top level is: a newer
    // build may say more about a slice than this schema knows.
    it("keeps an unknown key on a slice", ({ expect }) => {
      const manifest = twoSlices();
      (manifest.runtimes[0] as Record<string, unknown>).sizeBytes = 42;
      const parsed = buildManifestSchema.parse(manifest);
      const slice = parsed.runtimes?.[0] as Record<string, unknown> | undefined;
      expect(slice?.sizeBytes).toBe(42);
    });
  });

  describe("what it carries through", () => {
    /**
     * ⚠️ The property the whole schema is shaped around, and the reason it is
     * `.loose()` rather than merely not `.strict()`. A plain `z.object` does
     * not refuse an unknown key - it silently STRIPS it - so validating on the
     * write side would delete whatever this build has not caught up with, and
     * validating on the read side would hand a deployer a manifest with the
     * newer half missing.
     */
    it("keeps a field it has never heard of", ({ expect }) => {
      const parsed = buildManifestSchema.parse({
        ...valid(),
        somethingNewer: { nested: true },
      });
      expect((parsed as Record<string, unknown>).somethingNewer).toEqual({
        nested: true,
      });
    });

    it("keeps unknown keys inside an env entry, too", ({ expect }) => {
      const parsed = buildManifestSchema.parse({
        ...valid(),
        variables: [{ name: "TZ", description: "Zone", example: "UTC" }],
      });
      expect(parsed.variables[0]).toMatchObject({
        name: "TZ",
        description: "Zone",
        example: "UTC",
      });
    });
  });

  /**
   * The writer's `parse()` runs against a real `writeManifest`, not a literal,
   * so what the build produces and what the schema allows cannot drift.
   */
  describe("the writer", () => {
    class TestBuildManifestTask extends BuildManifestTask {
      public testWriteManifest = this.writeManifest.bind(this);
    }

    const createTask = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return {
        task: alepha.inject(TestBuildManifestTask),
        fs: alepha.inject(MemoryFileSystemProvider),
      };
    };

    const fakeAlepha = {
      primitives: () => [],
      inject: () => {
        throw new AlephaError("not available in this fake");
      },
      dump: () => {
        throw new AlephaError("not available in this fake");
      },
    } as any;

    /**
     * What the multi-slice build actually writes (epic #E63). The schema cases
     * above pin what the shape ALLOWS; this pins what the writer produces, and
     * the two used to be able to drift without anything noticing.
     */
    const writtenFor = async (
      options: Record<string, unknown>,
      alepha: unknown = fakeAlepha,
    ) => {
      const { task, fs } = createTask();
      await task.testWriteManifest(
        {
          alepha,
          root: "/root/my-app",
          options,
        } as any,
        "dist",
      );
      return JSON.parse(
        fs.getFileContent("/root/my-app/dist/manifest.json") ?? "{}",
      ) as BuildManifest;
    };

    it("writes one slice for a single-runtime build", async ({ expect }) => {
      const written = await writtenFor({ runtimes: ["node"] });
      expect(written.runtimes).toEqual([
        {
          runtime: "node",
          entry: "index.node.js",
          runtimeVersion: process.versions.node.split(".")[0],
        },
      ]);
    });

    it("writes node+workerd in declared order", async ({ expect }) => {
      const written = await writtenFor({ runtimes: ["node", "workerd"] });
      expect(
        written.runtimes.map(({ runtime, entry }) => ({ runtime, entry })),
      ).toEqual([
        { runtime: "node", entry: "index.node.js" },
        { runtime: "workerd", entry: "index.workerd.js" },
      ]);
      // workerd has no version to pin: Cloudflare picks it by date.
      expect(written.runtimes[1]?.runtimeVersion).toBeUndefined();
    });

    /**
     * ⚠️ The same two slices declared bun-first. Everything a deployer reads
     * has to move with the order, or the build's intent and the deploy diverge
     * with nothing to say which is right.
     */
    it("makes bun the primary when bun is declared first", async ({
      expect,
    }) => {
      const written = await writtenFor({ runtimes: ["bun", "node"] });
      expect(written.runtimes.map((slice) => slice.runtime)).toEqual([
        "bun",
        "node",
      ]);
      expect(written.runtimes[0]?.entry).toBe("index.bun.js");
    });

    /**
     * ⚠️ `entry` is a FILE now, not the `dist` directory. A deployer carrying
     * the old reading looks for a directory the flat archive does not have.
     */
    it("never writes a directory as the entry", async ({ expect }) => {
      const written = await writtenFor({ runtimes: ["node"] });
      expect(written.runtimes[0]?.entry).not.toBe("dist");
      expect(written.runtimes[0]?.entry).toMatch(/\.js$/);
    });

    // Nothing is spawned, so the one slice names no entry and no version:
    // either would be a claim about a process that does not exist.
    it("declares one static slice for a static build", async ({ expect }) => {
      const written = await writtenFor({ runtime: "static" });
      expect(written.runtimes).toEqual([{ runtime: "static" }]);
    });

    const withEnv = {
      ...fakeAlepha,
      dump: () => ({
        env: {
          APP_SECRET: { secret: true, description: "Signs sessions" },
          STRIPE_KEY: { secret: true },
          TZ: { secret: false, description: "Server time zone" },
        },
      }),
    };

    /**
     * ⚠️ Disjoint on purpose (#Q2465): each declared key lands in exactly one
     * list, so a deploy target never sees a variable listed as a secret too.
     */
    it("splits the declared env into disjoint secrets and variables", async ({
      expect,
    }) => {
      const written = await writtenFor({ runtimes: ["node"] }, withEnv);
      expect(written.secrets).toEqual([
        { name: "APP_SECRET", description: "Signs sessions" },
        { name: "STRIPE_KEY" },
      ]);
      expect(written.variables).toEqual([
        { name: "TZ", description: "Server time zone" },
      ]);
    });

    it("writes no cloudflare block without a workerd slice", async ({
      expect,
    }) => {
      const written = await writtenFor({ runtimes: ["node"] });
      expect(written.cloudflare).toBeUndefined();
    });

    it("groups what a Worker deploy reads under cloudflare", async ({
      expect,
    }) => {
      const written = await writtenFor({
        runtimes: ["node", "workerd"],
        cloudflare: { config: { limits: { cpu_ms: 300_000 } } },
      });
      expect(written.cloudflare).toEqual({
        config: { limits: { cpu_ms: 300_000 } },
        websocketPaths: [],
      });
    });
  });

  /**
   * `readManifest` reads through `node:fs/promises` directly rather than
   * `FileSystemProvider`, so a memory provider cannot stand in for the disk
   * here and these cases use a real temporary directory.
   */
  describe("the deploy-side reader", () => {
    class TestPlatformCommand extends PlatformCommand {
      public testReadManifest = this.readManifest.bind(this);
    }

    const roots: string[] = [];

    afterAll(async () => {
      for (const root of roots)
        await rm(root, { recursive: true, force: true });
    });

    const rootWith = async (contents: string) => {
      const root = await mkdtemp(join(tmpdir(), "alepha-manifest-"));
      roots.push(root);
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(root, "dist"), { recursive: true });
      await writeFile(join(root, "dist", "manifest.json"), contents, "utf-8");
      return root;
    };

    const command = () => Alepha.create().inject(TestPlatformCommand);

    it("reads a valid manifest", async ({ expect }) => {
      const root = await rootWith(JSON.stringify(valid()));
      const manifest = await command().testReadManifest(root);
      expect(manifest?.resources.hasDatabase).toBe(true);
    });

    /**
     * ⚠️ Without the schema this returned `{}` — truthy — and `resources`
     * flowed on as `undefined`. `null` is what the caller already knows how to
     * handle: it falls through to introspecting the app for real.
     */
    it("answers null for the empty manifest, instead of an object with no resources", async ({
      expect,
    }) => {
      const root = await rootWith("{}");
      expect(await command().testReadManifest(root)).toBeNull();
    });

    it("answers null for a truncated file", async ({ expect }) => {
      const root = await rootWith('{"version":1,"project":"my-a');
      expect(await command().testReadManifest(root)).toBeNull();
    });

    it("answers null when there is no manifest at all", async ({ expect }) => {
      const root = await mkdtemp(join(tmpdir(), "alepha-manifest-"));
      roots.push(root);
      expect(await command().testReadManifest(root)).toBeNull();
    });

    /**
     * A deployer meeting a NEWER artifact reads it rather than refusing it -
     * the same tolerance Bay's Go decoder gets for free, and the reason this
     * schema may never be `.strict()`.
     */
    it("reads a manifest from a newer build, unknown fields and all", async ({
      expect,
    }) => {
      const root = await rootWith(
        JSON.stringify({ ...valid(), fromTheFuture: ["a"] }),
      );
      const manifest = await command().testReadManifest(root);
      expect(manifest?.project).toBe("my-app");
      expect((manifest as Record<string, unknown>)?.fromTheFuture).toEqual([
        "a",
      ]);
    });
  });
});

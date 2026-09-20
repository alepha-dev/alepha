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
    version: 1,
    project: "my-app",
    defaultEnv: "production",
    environments: { production: { adapter: "cloudflare" } },
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
    websocketPaths: [],
    env: ["APP_SECRET"],
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

    // `runtime` is the one field a deployer switches on to decide what to
    // spawn, which is why it holds `static` instead of a `kind` of its own.
    it("refuses a runtime it cannot name", ({ expect }) => {
      expect(
        buildManifestSchema.safeParse({ ...valid(), runtime: "deno" }).success,
      ).toBe(false);
    });
  });

  /**
   * The multi-slice contract (epic #E63). `runtimes` is additive on purpose:
   * the scalar `runtime` keeps saying what it always said, so a deployer that
   * never learns about slices still spawns the primary.
   */
  describe("the slices it declares", () => {
    const twoSlices = () => ({
      ...valid(),
      runtime: "node",
      entry: "index.node.js",
      runtimes: [
        { runtime: "node", entry: "index.node.js" },
        { runtime: "workerd", entry: "index.workerd.js" },
      ],
    });

    it("accepts a manifest carrying only the scalar pair", ({ expect }) => {
      const parsed = buildManifestSchema.parse({
        ...valid(),
        runtime: "node",
        entry: "index.node.js",
      });
      expect(parsed.runtimes).toBeUndefined();
      expect(parsed.entry).toBe("index.node.js");
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
        runtime: "bun",
        entry: "index.bun.js",
        runtimes: [
          { runtime: "bun", entry: "index.bun.js" },
          { runtime: "node", entry: "index.node.js" },
        ],
      });
      expect(parsed.runtimes?.map((slice) => slice.runtime)).toEqual([
        "bun",
        "node",
      ]);
      // The scalar is runtimes[0], never a preference of the schema's own.
      expect(parsed.runtime).toBe("bun");
    });

    it("refuses a slice naming a runtime it cannot name", ({ expect }) => {
      const manifest = twoSlices();
      manifest.runtimes[1] = { runtime: "deno", entry: "index.deno.js" } as any;
      expect(buildManifestSchema.safeParse(manifest).success).toBe(false);
    });

    it("refuses a slice with no entry", ({ expect }) => {
      const manifest = twoSlices();
      delete (manifest.runtimes[0] as Record<string, unknown>).entry;
      expect(buildManifestSchema.safeParse(manifest).success).toBe(false);
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

    it("keeps unknown keys inside an environment, too", ({ expect }) => {
      const parsed = buildManifestSchema.parse({
        ...valid(),
        environments: {
          production: { adapter: "bay", host: "vps", socket: "/run/bay.sock" },
        },
      });
      expect(parsed.environments.production).toMatchObject({
        adapter: "bay",
        host: "vps",
        socket: "/run/bay.sock",
      });
    });
  });

  /**
   * The writer's `parse()` runs against a real `writeManifest`, not a literal:
   * `environments` reaches the manifest through a cast there, so the object
   * that is actually validated carries fields the schema has never declared.
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
    const writtenFor = async (options: Record<string, unknown>) => {
      const { task, fs } = createTask();
      await task.testWriteManifest(
        {
          alepha: fakeAlepha,
          root: "/root/my-app",
          platformOptions: { environments: {} },
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
        { runtime: "node", entry: "index.node.js" },
      ]);
      expect(written.runtime).toBe("node");
      expect(written.entry).toBe("index.node.js");
    });

    it("writes node+workerd in declared order", async ({ expect }) => {
      const written = await writtenFor({ runtimes: ["node", "workerd"] });
      expect(written.runtimes).toEqual([
        { runtime: "node", entry: "index.node.js" },
        { runtime: "workerd", entry: "index.workerd.js" },
      ]);
      // The scalars name the primary, which is runtimes[0] and nothing else.
      expect(written.runtime).toBe("node");
      expect(written.entry).toBe("index.node.js");
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
      expect(written.runtimes?.map((slice) => slice.runtime)).toEqual([
        "bun",
        "node",
      ]);
      expect(written.runtime).toBe("bun");
      expect(written.entry).toBe("index.bun.js");
    });

    /**
     * ⚠️ `entry` is a FILE now, not the `dist` directory. A deployer carrying
     * the old reading looks for a directory the flat archive does not have.
     */
    it("never writes a directory as the entry", async ({ expect }) => {
      const written = await writtenFor({ runtimes: ["node"] });
      expect(written.entry).not.toBe("dist");
      expect(written.entry).toMatch(/\.js$/);
    });

    // Nothing is spawned, so a slice array would be a claim rather than a fact:
    // it would name an entry file that the build never wrote.
    it("declares no slice and no entry for a static build", async ({
      expect,
    }) => {
      const written = await writtenFor({ target: "static" });
      expect(written.runtime).toBe("static");
      expect(written.runtimes).toBeUndefined();
      expect(written.entry).toBeUndefined();
    });

    /**
     * ⚠️ The regression this exists for: `EnvironmentConfig` declares `host`,
     * `socket`, `vars` and `services`, the manifest's own type declares none of
     * them, and the cast in `writeManifest` hides the difference. They are
     * written today, a Bay deploy reads them, and a plain `z.object().parse()`
     * on the way out would have removed them with nothing going red.
     */
    it("does not strip the environment fields the manifest type never declared", async ({
      expect,
    }) => {
      const { task, fs } = createTask();
      await task.testWriteManifest(
        {
          alepha: fakeAlepha,
          root: "/root/my-app",
          platformOptions: {
            environments: {
              production: {
                adapter: "bay",
                host: "vps.example.com",
                socket: "/run/bay.sock",
                vars: { TZ: "UTC" },
                services: [{ binding: "AUTH", service: "auth-worker" }],
              },
            },
          },
          options: {},
        } as any,
        "dist",
      );

      const written = JSON.parse(
        fs.getFileContent("/root/my-app/dist/manifest.json") ?? "{}",
      ) as BuildManifest;

      expect(written.environments.production).toMatchObject({
        adapter: "bay",
        host: "vps.example.com",
        socket: "/run/bay.sock",
        vars: { TZ: "UTC" },
        services: [{ binding: "AUTH", service: "auth-worker" }],
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

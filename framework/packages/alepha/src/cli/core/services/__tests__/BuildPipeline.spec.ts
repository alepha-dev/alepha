import { Alepha, type AlephaMeta } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { buildOptions } from "../../atoms/buildOptions.ts";
import {
  type AppEntry,
  AppEntryProvider,
} from "../../providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "../../providers/ViteBuildProvider.ts";
import { BuildTask, type BuildTaskContext } from "../../tasks/BuildTask.ts";
import { BuildPipeline } from "../BuildPipeline.ts";
import { MetaResolver } from "../MetaResolver.ts";
import { PackageManagerUtils } from "../PackageManagerUtils.ts";
import { ProjectScaffolder } from "../ProjectScaffolder.ts";

/**
 * Records the context every build hands its tasks.
 */
class RecordingTask extends BuildTask {
  public contexts: BuildTaskContext[] = [];

  async run(ctx: BuildTaskContext): Promise<void> {
    this.contexts.push(ctx);
  }
}

/**
 * The pipeline with its ten tasks replaced by one recorder, so a spec can read
 * what a build would have handed them without running Vite.
 */
class TestBuildPipeline extends BuildPipeline {
  public readonly recorder = new RecordingTask();
  protected override readonly tasks: BuildTask[] = [this.recorder];
}

class FakeAppEntryProvider extends AppEntryProvider {
  public override async getAppEntry(root: string): Promise<AppEntry> {
    return { root, server: "src/main.server.ts" };
  }
}

class FakeProjectScaffolder extends ProjectScaffolder {
  public override async ensureConfig(): Promise<void> {}
}

class FakePackageManagerUtils extends PackageManagerUtils {
  public override async hasExpo(): Promise<boolean> {
    return false;
  }
}

class FakeMetaResolver extends MetaResolver {
  public override async resolve(): Promise<AlephaMeta> {
    return { version: "test", runtime: "node" } as unknown as AlephaMeta;
  }

  public override install(): void {}
}

/**
 * The live app a build analyzes, reduced to the two answers the pipeline
 * reads from it.
 */
class FakeViteBuildProvider extends ViteBuildProvider {
  public analyzed = 0;

  public override async init(): Promise<Alepha> {
    this.analyzed += 1;
    return Alepha.create();
  }

  public override hasClient(): boolean {
    return true;
  }
}

const createPipeline = () => {
  const alepha = Alepha.create()
    .with({ provide: AppEntryProvider, use: FakeAppEntryProvider })
    .with({ provide: ProjectScaffolder, use: FakeProjectScaffolder })
    .with({ provide: PackageManagerUtils, use: FakePackageManagerUtils })
    .with({ provide: MetaResolver, use: FakeMetaResolver })
    .with({ provide: ViteBuildProvider, use: FakeViteBuildProvider })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
  alepha.store.register(buildOptions);
  return {
    alepha,
    pipeline: alepha.inject(TestBuildPipeline),
    fs: alepha.inject(MemoryFileSystemProvider),
    vite: alepha.inject(FakeViteBuildProvider),
  };
};

/**
 * A runner that runs every named step and records what it was asked to
 * delete.
 */
const createRunner = () => {
  const removed: string[] = [];
  const run = (async (task: any) => {
    if (typeof task === "object" && task?.handler) {
      await task.handler();
    }
    return "";
  }) as RunnerMethod;
  run.rm = async (glob: string | string[]) => {
    removed.push(...(Array.isArray(glob) ? glob : [glob]));
    return "";
  };
  return { run, removed };
};

describe("BuildPipeline", () => {
  describe("resolving the runtime declaration", () => {
    const runtimesOf = (runtime: any) =>
      createPipeline().pipeline.resolveOptions({
        root: "/app",
        run: createRunner().run,
        runtime,
      }).runtimes;

    /**
     * ⚠️ Cloudflare is no longer a target that forces a runtime: declaring a
     * workerd slice is what asks for a Worker, and that is the whole of it.
     */
    it("takes workerd as an ordinary declaration", ({ expect }) => {
      expect(runtimesOf("workerd")).toEqual(["workerd"]);
      expect(runtimesOf(["node", "workerd"])).toEqual(["node", "workerd"]);
    });

    /**
     * ⚠️ A static app declares `runtime: ["static"]` and gets NO slices.
     */
    it("resolves a static declaration to no slices at all", ({ expect }) => {
      expect(runtimesOf("static")).toEqual([]);
    });

    it("makes a shell static whatever the project declared", ({ expect }) => {
      const { alepha, pipeline } = createPipeline();
      alepha.store.set(buildOptions, { runtime: ["node", "workerd"] });

      const options = pipeline.resolveOptions({
        root: "/app",
        run: createRunner().run,
        shell: true,
      });

      expect(options.runtime).toBe("static");
      expect(options.runtimes).toEqual([]);
    });
  });

  describe("overrides belong to the call", () => {
    it("builds into the requested directory and cleans only that one", async ({
      expect,
    }) => {
      const { pipeline } = createPipeline();
      const { run, removed } = createRunner();

      await pipeline.build({
        root: "/app",
        run,
        output: { dist: "dist-capacitor" },
        shell: true,
      });

      const [ctx] = pipeline.recorder.contexts;
      expect(ctx.options.output?.dist).toBe("dist-capacitor");
      expect(removed).toEqual(["dist-capacitor"]);
    });

    it("leaves the project's build options as alepha.config.ts set them", async ({
      expect,
    }) => {
      const { alepha, pipeline } = createPipeline();
      alepha.store.set(buildOptions, {
        runtime: "node",
        output: { dist: "dist" },
      });
      const before = structuredClone(alepha.store.get(buildOptions));

      await pipeline.build({
        root: "/app",
        run: createRunner().run,
        output: { dist: "dist-capacitor" },
        shell: true,
      });

      expect(alepha.store.get(buildOptions)).toEqual(before);
      expect(alepha.store.get(buildOptions).output?.dist).toBe("dist");
    });

    it("writes the resolved options back only when asked to, as alepha build does", async ({
      expect,
    }) => {
      const { alepha, pipeline } = createPipeline();
      alepha.store.set(buildOptions, { runtime: ["bun", "node"] });

      await pipeline.build({
        root: "/app",
        run: createRunner().run,
        persist: true,
      });

      expect(alepha.store.get(buildOptions).runtime).toBe("bun");
      expect(alepha.store.get(buildOptions).runtimes).toEqual(["bun", "node"]);
    });

    it("hands the caller's client constants and the shell flag to every task", async ({
      expect,
    }) => {
      const { pipeline } = createPipeline();

      await pipeline.build({
        root: "/app",
        run: createRunner().run,
        define: {
          __APP_CONFIG__: JSON.stringify({ apiUrl: "https://x.test" }),
        },
        shell: true,
      });

      const [ctx] = pipeline.recorder.contexts;
      expect(ctx.define).toEqual({
        __APP_CONFIG__: '{"apiUrl":"https://x.test"}',
      });
      expect(ctx.flags?.shell).toBe(true);
    });

    it("gives a plain build no constants of its own", async ({ expect }) => {
      const { pipeline } = createPipeline();

      await pipeline.build({ root: "/app", run: createRunner().run });

      const [ctx] = pipeline.recorder.contexts;
      expect(ctx.define).toBeUndefined();
      expect(ctx.flags?.shell).toBeUndefined();
    });
  });

  describe("a prebuilt build", () => {
    const manifest = JSON.stringify({
      manifestVersion: 2,
      project: "fixture",
      runtimes: [{ runtime: "node", entry: "index.node.js" }],
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
    });

    it("reads the manifest of dist and analyzes no app", async ({ expect }) => {
      const { pipeline, fs, vite } = createPipeline();
      await fs.writeFile("/app/dist/manifest.json", manifest);

      await pipeline.build({
        root: "/app",
        run: createRunner().run,
        prebuilt: true,
      });

      const [ctx] = pipeline.recorder.contexts;
      expect(ctx.manifest?.project).toBe("fixture");
      expect(vite.analyzed).toBe(0);
    });

    it("reads the manifest where output.dist says the artifact is", async ({
      expect,
    }) => {
      const { pipeline, fs, vite } = createPipeline();
      await fs.writeFile("/app/out/manifest.json", manifest);

      await pipeline.build({
        root: "/app",
        run: createRunner().run,
        prebuilt: true,
        output: { dist: "out" },
      });

      const [ctx] = pipeline.recorder.contexts;
      expect(ctx.manifest?.project).toBe("fixture");
      expect(vite.analyzed).toBe(0);
    });
  });
});

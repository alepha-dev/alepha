import { Alepha } from "alepha";
import { BuildPipeline, type BuildRequest, type BuildResult } from "alepha/cli";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { capacitorOptions } from "../atoms/capacitorOptions.ts";
import { CapacitorCommand } from "../commands/CapacitorCommand.ts";
import { AlephaCliCapacitorPlugin } from "../index.ts";
import { CapacitorNativeBuild } from "../services/CapacitorNativeBuild.ts";
import { NativeBuildRecords } from "../services/NativeBuildRecords.ts";
import { seedNativeProject } from "./memoryProject.ts";

/**
 * The shell build, recorded instead of run.
 */
class RecordingBuildPipeline extends BuildPipeline {
  public requests: BuildRequest[] = [];

  public override async build(request: BuildRequest): Promise<BuildResult> {
    this.requests.push(request);
    return { skipped: false };
  }
}

class MacNativeBuild extends CapacitorNativeBuild {
  protected override hostPlatform(): NodeJS.Platform {
    return "darwin";
  }
}

class LinuxNativeBuild extends CapacitorNativeBuild {
  protected override hostPlatform(): NodeJS.Platform {
    return "linux";
  }
}

const ROOT = "/app";
const APK = `${ROOT}/android/app/build/outputs/apk/debug/app-debug.apk`;

const setup = async (
  opts: { env?: Record<string, string>; host?: "darwin" | "linux" } = {},
) => {
  const alepha = Alepha.create({ env: opts.env ?? {} })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: BuildPipeline, use: RecordingBuildPipeline })
    .with({
      provide: CapacitorNativeBuild,
      use: opts.host === "linux" ? LinuxNativeBuild : MacNativeBuild,
    })
    .with(AlephaCliCapacitorPlugin);
  alepha.store.set(capacitorOptions, {
    appId: "dev.alepha.mobile",
    appName: "Mobile",
    scheme: "mobile",
    apiUrl: "https://api.test",
    iosTeamId: "TEAM123",
  });

  const fs = alepha.inject(MemoryFileSystemProvider);
  const shell = alepha.inject(MemoryShellProvider);
  const pipeline = alepha.inject(RecordingBuildPipeline);
  const cli = alepha.inject(CliProvider);
  const cmd = alepha.inject(CapacitorCommand);
  const records = alepha.inject(NativeBuildRecords);
  await seedNativeProject(fs, ROOT);
  // What gradle would leave behind.
  await fs.writeFile(APK, "apk bytes");

  return {
    alepha,
    fs,
    shell,
    pipeline,
    records,
    sync: (argv = "") => cli.run(cmd.sync, { argv, root: ROOT }),
    build: (argv: string) => cli.run(cmd.build, { argv, root: ROOT }),
  };
};

describe("alepha capacitor sync", () => {
  it("builds a lean shell into dist-capacitor with the public config, never dist", async ({
    expect,
  }) => {
    const { pipeline, sync } = await setup();

    await sync();

    const [request] = pipeline.requests;
    expect(request.shell).toBe(true);
    expect(request.output).toEqual({ dist: "dist-capacitor" });
    expect(request.shellViewport).toContain("viewport-fit=cover");
    expect(JSON.parse(request.define?.__ALEPHA_CAPACITOR__ ?? "{}")).toEqual({
      appId: "dev.alepha.mobile",
      variant: "base",
      scheme: "mobile",
      mode: "bundled",
      apiUrl: "https://api.test",
      env: {},
    });
  });

  it("copies the shell into every native project", async ({ expect }) => {
    const { shell, sync } = await setup();

    await sync();

    expect(shell.wasCalled("yarn cap sync ios")).toBe(true);
    expect(shell.wasCalled("yarn cap sync android")).toBe(true);
  });

  it("stops at the shell with --web-only", async ({ expect }) => {
    const { shell, pipeline, sync } = await setup();

    await sync("--web-only");

    expect(pipeline.requests).toHaveLength(1);
    expect(shell.wasCalledMatching(/cap sync/)).toBe(false);
  });

  it("refuses a bundled shell with no API origin", async ({ expect }) => {
    const { alepha, pipeline, sync } = await setup();
    alepha.store.set(capacitorOptions, {
      appId: "dev.alepha.mobile",
      appName: "Mobile",
      scheme: "mobile",
    });

    await expect(sync()).rejects.toThrow(/origin of its API/);
    expect(pipeline.requests).toEqual([]);
  });

  it("refuses when development settings survive the sync", async ({
    expect,
  }) => {
    // The memory shell rewrites nothing, which is what a real `cap sync`
    // does to Info.plist: residue there outlives the sync.
    const { fs, sync } = await setup();
    const plist = `${ROOT}/ios/App/App/Info.plist`;
    await fs.writeFile(
      plist,
      (fs.getFileContent(plist) ?? "").replace(
        "<dict>\n",
        "<dict>\n\t<key>NSAllowsArbitraryLoads</key>\n\t<true/>\n",
      ),
    );

    await expect(sync()).rejects.toThrow(/after sync/);
  });
});

describe("alepha capacitor build", () => {
  it("syncs, compiles a debug APK and records it", async ({ expect }) => {
    const { shell, pipeline, records, build } = await setup();

    await build("android");

    expect(pipeline.requests).toHaveLength(1);
    const gradle = shell.calls.find((call) => call.command.includes("gradlew"));
    expect(gradle?.argv).toEqual(["./gradlew", "assembleDebug"]);
    expect(gradle?.options.root).toBe(`${ROOT}/android`);

    const [record] = await records.read(ROOT);
    expect(record).toMatchObject({
      appId: "dev.alepha.mobile",
      platform: "android",
      versionBuild: "1",
      variant: "base",
      configuration: "debug",
      signing: "debug",
      artifact: { path: "android/app/build/outputs/apk/debug/app-debug.apk" },
    });
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("appends nothing when the native build fails", async ({ expect }) => {
    const { shell, records, build } = await setup();
    shell.configure({ errors: { "./gradlew assembleDebug": "gradle broke" } });

    await expect(build("android")).rejects.toThrow();
    expect(await records.read(ROOT)).toEqual([]);
  });

  it("appends once for the same build from the same inputs", async ({
    expect,
  }) => {
    const { records, build } = await setup();

    await build("android");
    await build("android");

    expect(await records.read(ROOT)).toHaveLength(1);
  });

  it("refuses a reused build number from other native inputs before syncing", async ({
    expect,
  }) => {
    const { fs, pipeline, records, build } = await setup();
    await build("android");
    pipeline.requests = [];
    await fs.writeFile(
      `${ROOT}/android/build.gradle`,
      "buildscript { changed }",
    );

    await expect(build("android")).rejects.toThrow(
      /Bump the native build number/,
    );
    expect(pipeline.requests).toEqual([]);
    expect(await records.read(ROOT)).toHaveLength(1);
  });

  it("refuses dev residue before the sync could erase it", async ({
    expect,
  }) => {
    const { fs, pipeline, build } = await setup();
    await fs.writeFile(
      `${ROOT}/android/app/src/main/assets/capacitor.config.json`,
      JSON.stringify({ server: { url: "http://192.168.1.2:5173" } }),
    );

    await expect(build("android")).rejects.toThrow(/before sync/);
    expect(pipeline.requests).toEqual([]);
  });

  it("signs an Android release from the environment, masking the passwords", async ({
    expect,
  }) => {
    const { fs, shell, build } = await setup({
      env: {
        CAPACITOR_ANDROID_KEYSTORE_PATH: "/keys/upload.jks",
        CAPACITOR_ANDROID_KEYSTORE_PASSWORD: "store-secret",
        CAPACITOR_ANDROID_KEY_ALIAS: "upload",
        CAPACITOR_ANDROID_KEY_PASSWORD: "key-secret",
      },
    });
    await fs.writeFile(
      `${ROOT}/android/app/build/outputs/bundle/release/app-release-signed.aab`,
      "aab",
    );

    await build("android --release");

    const call = shell.calls.find((c) => c.command.startsWith("cap build"));
    expect(call?.argv).toContain("store-secret");
    expect(call?.options.redact).toEqual(["store-secret", "key-secret"]);
    expect(call?.options.resolve).toBe(true);
  });

  it("refuses an Android release with no keystore in the environment", async ({
    expect,
  }) => {
    const { pipeline, build } = await setup();

    await expect(build("android --release")).rejects.toThrow(
      /CAPACITOR_ANDROID_KEYSTORE_PATH/,
    );
    expect(pipeline.requests).toEqual([]);
  });

  it("exports an iOS release for debugging unless told otherwise", async ({
    expect,
  }) => {
    const { fs, shell, build } = await setup();
    await fs.writeFile(`${ROOT}/ios/App/output/App.ipa`, "ipa");

    await build("ios --release");

    const call = shell.calls.find((c) => c.command.startsWith("cap build ios"));
    const argv = call?.argv ?? [];
    expect(argv[argv.indexOf("--xcode-export-method") + 1]).toBe("debugging");
    expect(argv[argv.indexOf("--xcode-team-id") + 1]).toBe("TEAM123");
  });

  it("refuses iOS off a Mac", async ({ expect }) => {
    const { pipeline, build } = await setup({ host: "linux" });

    await expect(build("ios")).rejects.toThrow(/needs macOS/);
    expect(pipeline.requests).toEqual([]);
  });
});

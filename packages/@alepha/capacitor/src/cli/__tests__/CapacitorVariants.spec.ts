import { Alepha } from "alepha";
import { BuildPipeline, type BuildRequest, type BuildResult } from "alepha/cli";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import sharp from "sharp";
import { describe, it } from "vitest";

import {
  type CapacitorOptions,
  capacitorOptions,
} from "../atoms/capacitorOptions.ts";
import { CapacitorCommand } from "../commands/CapacitorCommand.ts";
import { AlephaCliCapacitorPlugin } from "../index.ts";
import { CapacitorNativeBuild } from "../services/CapacitorNativeBuild.ts";
import { NativeAssets } from "../services/NativeAssets.ts";
import { NativeBuildRecords } from "../services/NativeBuildRecords.ts";
import { capacitorTemplates } from "./fixtures.ts";
import { seedNativeProject } from "./memoryProject.ts";

const ROOT = "/app";
const PBXPROJ = `${ROOT}/ios/App/App.xcodeproj/project.pbxproj`;
const PLIST = `${ROOT}/ios/App/App/Info.plist`;
const GRADLE = `${ROOT}/android/app/build.gradle`;
const STRINGS = `${ROOT}/android/app/src/main/res/values/strings.xml`;
const MANIFEST = `${ROOT}/android/app/src/main/AndroidManifest.xml`;
const CONFIG = `${ROOT}/capacitor.config.ts`;

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

const base: CapacitorOptions = {
  appId: "dev.alepha.mobile",
  appName: "Mobile",
  scheme: "mobile",
  apiUrl: "https://api.test",
  icon: { source: "icon.png", background: "#ffffff" },
  variants: {
    acme: {
      appId: "dev.alepha.acme",
      appName: "Acme & Co",
      scheme: "acme",
      apiUrl: "https://acme.test",
      icon: { source: "acme.png", background: "#0f172a" },
      env: { BRAND: "acme" },
    },
  },
};

const setup = async (options: CapacitorOptions = base) => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: BuildPipeline, use: RecordingBuildPipeline })
    .with({ provide: CapacitorNativeBuild, use: MacNativeBuild })
    .with(AlephaCliCapacitorPlugin);
  alepha.store.set(capacitorOptions, options);

  const fs = alepha.inject(MemoryFileSystemProvider);
  await seedNativeProject(fs, ROOT);
  await fs.writeFile(PLIST, capacitorTemplates.infoPlist);
  await fs.writeFile(MANIFEST, capacitorTemplates.androidManifest);
  const square = (color: string) =>
    sharp({
      create: { width: 1024, height: 1024, channels: 4, background: color },
    })
      .png()
      .toBuffer();
  await fs.writeFile(`${ROOT}/icon.png`, await square("#16a34a"));
  await fs.writeFile(`${ROOT}/acme.png`, await square("#e11d48"));
  await fs.writeFile(
    `${ROOT}/android/app/build/outputs/apk/debug/app-debug.apk`,
    "apk",
  );

  const cli = alepha.inject(CliProvider);
  const cmd = alepha.inject(CapacitorCommand);
  const run = (
    name: "init" | "sync" | "build" | "dev" | "open",
    argv: string,
  ) => cli.run(cmd[name], { argv, root: ROOT });

  /**
   * Every file the identity writer owns, as it stands.
   */
  const owned = async () => {
    const assets = alepha
      .inject(NativeAssets)
      .outputs(["ios", "android"])
      .map((path) => `${ROOT}/${path}`);
    const paths = [
      PBXPROJ,
      PLIST,
      GRADLE,
      STRINGS,
      MANIFEST,
      CONFIG,
      ...assets,
    ];
    const files: Record<string, Buffer | undefined> = {};
    for (const path of paths) {
      files[path] = (await fs.exists(path))
        ? await fs.readFile(path)
        : undefined;
    }
    return files;
  };

  return {
    alepha,
    fs,
    run,
    owned,
    pipeline: alepha.inject(RecordingBuildPipeline),
    shell: alepha.inject(MemoryShellProvider),
    records: alepha.inject(NativeBuildRecords),
  };
};

describe("capacitor variants", () => {
  describe("the declaration", () => {
    it("refuses two identities sharing an appId or a scheme", async ({
      expect,
    }) => {
      const sameId = await setup({
        ...base,
        variants: { acme: { appId: base.appId, scheme: "acme" } },
      });
      await expect(sameId.run("sync", "--variant acme")).rejects.toThrow(
        /share the appId/,
      );

      const sameScheme = await setup({
        ...base,
        variants: { acme: { appId: "dev.alepha.acme" } },
      });
      await expect(sameScheme.run("sync", "--variant acme")).rejects.toThrow(
        /share the scheme/,
      );
    });

    it("refuses a variant icon without a base icon, and credential-like env", async ({
      expect,
    }) => {
      const { icon: _icon, ...noIcon } = base;
      const iconless = await setup(noIcon);
      await expect(iconless.run("sync", "--variant base")).rejects.toThrow(
        /Declare a base icon/,
      );

      const leaky = await setup({
        ...base,
        variants: {
          acme: {
            ...base.variants?.acme,
            env: { STRIPE_SECRET: "sk_live" },
          },
        },
      });
      await expect(leaky.run("sync", "--variant acme")).rejects.toThrow(
        /looks like a credential/,
      );
    });

    it("refuses a malformed variant name", async ({ expect }) => {
      const { run } = await setup({
        ...base,
        variants: { "Acme Co": { appId: "dev.alepha.acme", scheme: "acme" } },
      });

      await expect(run("sync", "--variant base")).rejects.toThrow(
        /lowercase letters/,
      );
    });
  });

  describe("selection", () => {
    it("refuses every command without --variant once variants exist", async ({
      expect,
    }) => {
      const { run, pipeline, shell } = await setup();

      for (const [name, argv] of [
        ["init", ""],
        ["sync", ""],
        ["build", "android"],
        ["dev", "android"],
        ["open", "android"],
      ] as const) {
        await expect(run(name, argv), name).rejects.toThrow(
          /--variant base for the base identity/,
        );
      }
      expect(pipeline.requests).toEqual([]);
      expect(shell.calls).toEqual([]);
    });

    it("refuses an unknown variant, and a variant on an app without any", async ({
      expect,
    }) => {
      const { run } = await setup();
      await expect(run("sync", "--variant nope")).rejects.toThrow(
        /Unknown variant "nope"/,
      );

      const { variants: _variants, ...single } = base;
      const plain = await setup(single);
      await expect(plain.run("sync", "--variant acme")).rejects.toThrow(
        /Unknown variant "acme"/,
      );
      await plain.run("sync", "--variant base");
    });

    it("builds each variant's shell into its own directory with its public config", async ({
      expect,
    }) => {
      const { run, pipeline, fs } = await setup();

      await run("sync", "--variant acme");
      await run("sync", "--variant base");

      const [acme, baseBuild] = pipeline.requests;
      expect(acme.output).toEqual({ dist: "dist-capacitor/acme" });
      expect(
        JSON.parse(acme.define?.__ALEPHA_CAPACITOR__ ?? "{}"),
      ).toMatchObject({
        appId: "dev.alepha.acme",
        variant: "acme",
        scheme: "acme",
        apiUrl: "https://acme.test",
        env: { BRAND: "acme" },
      });
      expect(baseBuild.output).toEqual({ dist: "dist-capacitor/base" });
      expect(fs.getFileContent(CONFIG)).toContain(
        'webDir: "dist-capacitor/base/public"',
      );
    });

    it("records each variant's build apart", async ({ expect }) => {
      const { run, records } = await setup();

      await run("build", "android --variant acme");
      await run("build", "android --variant base");

      const built = await records.read(ROOT);
      expect(built.map((it) => [it.variant, it.appId])).toEqual([
        ["acme", "dev.alepha.acme"],
        ["base", "dev.alepha.mobile"],
      ]);
      expect(built[0].fingerprint).not.toBe(built[1].fingerprint);
    });
  });

  describe("the identity writer", () => {
    it("writes the selected identity into both native projects", async ({
      expect,
    }) => {
      const { run, fs } = await setup();

      await run("sync", "--variant acme");

      expect(fs.getFileContent(PBXPROJ)).toContain(
        "PRODUCT_BUNDLE_IDENTIFIER = dev.alepha.acme;",
      );
      expect(fs.getFileContent(PBXPROJ)).not.toContain("dev.alepha.mobile");
      const plist = fs.getFileContent(PLIST) ?? "";
      expect(plist).toContain("<string>Acme &amp; Co</string>");
      expect(plist).toContain("<string>acme</string>");
      expect(fs.getFileContent(GRADLE)).toContain(
        'applicationId "dev.alepha.acme"',
      );
      // The Java namespace names the code, not the app: it stays.
      expect(fs.getFileContent(GRADLE)).toContain(
        'namespace = "dev.alepha.mobile"',
      );
      expect(fs.getFileContent(STRINGS)).toContain(
        '<string name="app_name">Acme &amp; Co</string>',
      );
      expect(fs.getFileContent(MANIFEST)).toContain('android:scheme="acme"');
      expect(fs.getFileContent(CONFIG)).toContain('appId: "dev.alepha.acme"');
      expect(
        fs.getFileContent(
          `${ROOT}/android/app/src/main/res/values/ic_launcher_background.xml`,
        ),
      ).toContain("#0F172A");
    });

    it("leaves every owned file byte-identical after x, then y, then x", async ({
      expect,
    }) => {
      const { run, owned } = await setup();

      await run("sync", "--variant base");
      const first = await owned();
      await run("sync", "--variant acme");
      const middle = await owned();
      await run("sync", "--variant base");
      const again = await owned();

      for (const [path, content] of Object.entries(first)) {
        expect(again[path]?.equals(content as Buffer), path).toBe(true);
      }
      expect(middle[PLIST]?.equals(first[PLIST] as Buffer)).toBe(false);
    });

    it("refuses an unsupported layout before writing anything", async ({
      expect,
    }) => {
      const { run, fs } = await setup();
      await fs.writeFile(`${ROOT}/ios/App/Podfile`, "platform :ios");
      fs.writeFileCalls = [];

      await expect(run("sync", "--variant acme")).rejects.toThrow(/CocoaPods/);
      expect(fs.writeFileCalls).toEqual([]);

      await fs.rm(`${ROOT}/ios/App/Podfile`);
      await fs.writeFile(
        PBXPROJ,
        `${capacitorTemplates.pbxproj}\nPRODUCT_BUNDLE_IDENTIFIER = dev.alepha.mobile.widget;\n`,
      );
      fs.writeFileCalls = [];
      await expect(run("sync", "--variant acme")).rejects.toThrow(
        /several different PRODUCT_BUNDLE_IDENTIFIER/,
      );
      expect(fs.writeFileCalls).toEqual([]);
    });

    it("refuses URL types and intent filters it did not register", async ({
      expect,
    }) => {
      const { run, fs } = await setup();
      await run("sync", "--variant base");
      const plist = fs.getFileContent(PLIST) ?? "";
      await fs.writeFile(
        PLIST,
        plist.replace(
          "<string>mobile</string>",
          "<string>mobile</string>\n\t\t\t\t<string>other</string>",
        ),
      );
      fs.writeFileCalls = [];

      await expect(run("sync", "--variant acme")).rejects.toThrow(
        /URL types of its own/,
      );
      expect(fs.writeFileCalls).toEqual([]);
    });

    it("puts every file back when the switch fails halfway", async ({
      expect,
    }) => {
      const { run, fs, owned } = await setup({
        ...base,
        variants: {
          acme: {
            ...base.variants?.acme,
            icon: { source: "missing.png" },
          },
        },
      });
      await run("sync", "--variant base");
      const before = await owned();

      await expect(run("sync", "--variant acme")).rejects.toThrow(
        /does not exist/,
      );

      const after = await owned();
      for (const [path, content] of Object.entries(before)) {
        expect(after[path]?.equals(content as Buffer), path).toBe(true);
      }
      expect(fs.getFileContent(PBXPROJ)).toContain("dev.alepha.mobile;");
    });

    it("runs one command at a time per project", async ({ expect }) => {
      const { run, fs, pipeline } = await setup();
      await fs.mkdir(`${ROOT}/.capacitor-lock`, { recursive: true });

      await expect(run("sync", "--variant acme")).rejects.toThrow(
        /Another alepha capacitor command is running/,
      );
      expect(pipeline.requests).toEqual([]);

      await fs.rm(`${ROOT}/.capacitor-lock`, { recursive: true });
      await run("sync", "--variant acme");
      expect(await fs.exists(`${ROOT}/.capacitor-lock`)).toBe(false);
    });
  });
});

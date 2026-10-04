import { Alepha } from "alepha";
import { defineConfig } from "alepha/cli/config";
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
import { AlephaCliCapacitorPlugin, capacitor } from "../index.ts";
import { CapacitorInit } from "../services/CapacitorInit.ts";
import { capacitorTemplates } from "./fixtures.ts";

/**
 * Init on a host that is not a Mac.
 */
class LinuxCapacitorInit extends CapacitorInit {
  protected override hostPlatform(): NodeJS.Platform {
    return "linux";
  }
}

/**
 * Init on a Mac, whatever runs the spec.
 */
class MacCapacitorInit extends CapacitorInit {
  protected override hostPlatform(): NodeJS.Platform {
    return "darwin";
  }
}

const ROOT = "/project";

const setup = async (opts: { host?: "darwin" | "linux" } = {}) => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({
      provide: CapacitorInit,
      use: opts.host === "linux" ? LinuxCapacitorInit : MacCapacitorInit,
    })
    .with(AlephaCliCapacitorPlugin);
  alepha.store.set(capacitorOptions, {
    appId: "dev.alepha.mobile",
    appName: "Mobile",
    scheme: "mobile",
  });

  const fs = alepha.inject(MemoryFileSystemProvider);
  const shell = alepha.inject(MemoryShellProvider);
  const cli = alepha.inject(CliProvider);
  const cmd = alepha.inject(CapacitorCommand);

  await fs.writeFile(
    `${ROOT}/package.json`,
    JSON.stringify({ name: "mobile", dependencies: {} }),
  );
  await fs.writeFile(`${ROOT}/yarn.lock`, "");

  const init = (argv = "") => cli.run(cmd.init, { argv, root: ROOT });

  /**
   * What `cap add` would have produced, which the memory shell does not.
   */
  const addNativeProjects = async () => {
    await fs.writeFile(
      `${ROOT}/ios/App/App/Info.plist`,
      capacitorTemplates.infoPlist,
    );
    await fs.writeFile(
      `${ROOT}/android/app/src/main/AndroidManifest.xml`,
      capacitorTemplates.androidManifest,
    );
  };

  /**
   * What the install would have written into package.json.
   */
  const installEverything = async () => {
    await fs.writeFile(
      `${ROOT}/package.json`,
      JSON.stringify({
        name: "mobile",
        dependencies: {
          "@capacitor/core": "8.5.2",
          "@capacitor/ios": "8.5.2",
          "@capacitor/android": "8.5.2",
          "@capacitor/app": "8.1.2",
          "@capacitor/device": "8.0.3",
          "@capacitor/haptics": "8.0.2",
          "@capacitor/splash-screen": "8.0.2",
          "@aparajita/capacitor-secure-storage": "8.0.1",
        },
        devDependencies: { "@capacitor/cli": "8.5.2" },
      }),
    );
  };

  return {
    alepha,
    fs,
    shell,
    init,
    addNativeProjects,
    installEverything,
  };
};

describe("alepha capacitor init", () => {
  it("installs the pinned packages with the project's package manager", async ({
    expect,
  }) => {
    const { shell, init } = await setup();

    await init();

    expect(
      shell.wasCalled(
        "yarn add @capacitor/core@8.5.2 @capacitor/ios@8.5.2 @capacitor/android@8.5.2 @capacitor/app@8.1.2 @capacitor/device@8.0.3 @capacitor/haptics@8.0.2 @capacitor/splash-screen@8.0.2 @aparajita/capacitor-secure-storage@8.0.1",
      ),
    ).toBe(true);
    expect(shell.wasCalled("yarn add -D @capacitor/cli@8.5.2")).toBe(true);
  });

  it("generates capacitor.config.ts from alepha.config.ts", async ({
    expect,
  }) => {
    const { fs, init } = await setup();

    await init();

    const config = fs.getFileContent(`${ROOT}/capacitor.config.ts`);
    expect(config).toContain('appId: "dev.alepha.mobile"');
    expect(config).toContain('webDir: "dist-capacitor/public"');
  });

  it("adds both platforms through the app's own cap binary, iOS on SPM", async ({
    expect,
  }) => {
    const { shell, init } = await setup();

    await init();

    expect(shell.wasCalled("yarn cap add ios --packagemanager SPM")).toBe(true);
    expect(shell.wasCalled("yarn cap add android")).toBe(true);
  });

  it("gives cap add a web directory to copy before the first sync", async ({
    expect,
  }) => {
    const { fs, init } = await setup();

    await init();

    expect(await fs.exists(`${ROOT}/dist-capacitor/public/index.html`)).toBe(
      true,
    );
  });

  it("ignores the shell's output and signing keys, never the native projects", async ({
    expect,
  }) => {
    const { fs, init } = await setup();
    await fs.writeFile(`${ROOT}/.gitignore`, "node_modules\n");

    await init();

    const ignore = fs.getFileContent(`${ROOT}/.gitignore`) ?? "";
    expect(ignore.startsWith("node_modules\n")).toBe(true);
    expect(ignore).toContain("/dist-capacitor\n");
    expect(ignore).toContain("*.keystore\n");
    expect(ignore).not.toMatch(/^\/?(ios|android)\/?$/m);
  });

  it("keeps an app's own formatter out of the native projects", async ({
    expect,
  }) => {
    const { fs, init } = await setup();
    await fs.writeFile(
      `${ROOT}/.oxfmtrc.json`,
      JSON.stringify({ ignorePatterns: ["dist"] }),
    );

    await init();

    expect(
      JSON.parse(fs.getFileContent(`${ROOT}/.oxfmtrc.json`) ?? "{}")
        .ignorePatterns,
    ).toEqual(["dist", "ios", "android"]);
  });

  it("registers the URL scheme in both native projects", async ({ expect }) => {
    const { fs, init, addNativeProjects } = await setup();
    await addNativeProjects();

    await init();

    expect(fs.getFileContent(`${ROOT}/ios/App/App/Info.plist`)).toContain(
      "<string>mobile</string>",
    );
    expect(
      fs.getFileContent(`${ROOT}/android/app/src/main/AndroidManifest.xml`),
    ).toContain('android:scheme="mobile"');
  });

  it("is a no-op the second time", async ({ expect }) => {
    const { fs, shell, init, addNativeProjects, installEverything } =
      await setup();
    await addNativeProjects();
    await installEverything();
    await init();
    shell.reset();
    fs.writeFileCalls = [];

    await init();

    expect(shell.calls).toEqual([]);
    expect(fs.writeFileCalls).toEqual([]);
  });

  it("keeps the user's own edits to the native projects", async ({
    expect,
  }) => {
    const { fs, init, addNativeProjects, installEverything } = await setup();
    await addNativeProjects();
    await installEverything();
    await init();
    const plistPath = `${ROOT}/ios/App/App/Info.plist`;
    const edited = (fs.getFileContent(plistPath) ?? "").replace(
      "<dict>\n",
      "<dict>\n\t<key>NSCameraUsageDescription</key>\n\t<string>Scan</string>\n",
    );
    await fs.writeFile(plistPath, edited);

    await init();

    expect(fs.getFileContent(plistPath)).toBe(edited);
  });

  it("refuses a capacitor.config.ts it did not write, and leaves it", async ({
    expect,
  }) => {
    const { fs, init } = await setup();
    const own = "export default { appId: 'mine' };\n";
    await fs.writeFile(`${ROOT}/capacitor.config.ts`, own);

    await expect(init()).rejects.toThrow(/was not generated/);
    expect(fs.getFileContent(`${ROOT}/capacitor.config.ts`)).toBe(own);
  });

  it("refuses iOS off a Mac before writing or installing anything", async ({
    expect,
  }) => {
    const { fs, shell, init } = await setup({ host: "linux" });
    fs.writeFileCalls = [];

    await expect(init()).rejects.toThrow(/needs macOS/);
    expect(shell.calls).toEqual([]);
    expect(fs.writeFileCalls).toEqual([]);
  });

  it("does Android alone off a Mac when asked", async ({ expect }) => {
    const { shell, init } = await setup({ host: "linux" });

    await init("--platform android");

    expect(shell.wasCalled("yarn cap add android")).toBe(true);
    expect(shell.wasCalledMatching(/cap add ios/)).toBe(false);
  });
});

describe("capacitor()", () => {
  it("registers the command family and the options", async ({ expect }) => {
    // The way the CLI loads alepha.config.ts.
    const alepha = Alepha.create();
    defineConfig({
      plugins: [
        capacitor({
          appId: "dev.alepha.mobile",
          appName: "Mobile",
          scheme: "m",
        }),
      ],
    })(alepha);

    const family = alepha.inject(CapacitorCommand).capacitor;
    expect(family.children.map((child) => child.name)).toEqual([
      "init",
      "sync",
      "build",
      "dev",
      "open",
    ]);
    expect(alepha.store.get(capacitorOptions)?.appId).toBe("dev.alepha.mobile");
  });

  it("refuses a malformed identity when the config loads", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    expect(() =>
      defineConfig({
        plugins: [
          capacitor({ appId: "mobile", appName: "Mobile", scheme: "mobile" }),
        ],
      })(alepha),
    ).toThrow(/reverse-DNS/);
  });
});

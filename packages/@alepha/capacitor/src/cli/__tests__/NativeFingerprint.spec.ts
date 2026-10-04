import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { NativeFingerprint } from "../services/NativeFingerprint.ts";
import { seedNativeProject } from "./memoryProject.ts";

const ROOT = "/app";
const identity = {
  appId: "dev.alepha.mobile",
  appName: "Mobile",
  scheme: "mobile",
  variant: "base",
};

const setup = async () => {
  const alepha = Alepha.create().with({
    provide: FileSystemProvider,
    use: MemoryFileSystemProvider,
  });
  const fs = alepha.inject(MemoryFileSystemProvider);
  await seedNativeProject(fs, ROOT);
  const fingerprint = alepha.inject(NativeFingerprint);
  const compute = (platform: "ios" | "android" = "android") =>
    fingerprint.compute({ root: ROOT, platform, identity });
  return { fs, compute };
};

describe("NativeFingerprint", () => {
  it("is stable for unchanged inputs", async ({ expect }) => {
    const { compute } = await setup();

    expect((await compute()).fingerprint).toBe((await compute()).fingerprint);
  });

  it("reads the native sources and Gradle files, not build products or generated assets", async ({
    expect,
  }) => {
    const { compute } = await setup();

    const files = Object.keys((await compute()).inputs)
      .filter((key) => key.startsWith("file:"))
      .sort();

    expect(files).toEqual([
      "file:android/app/build.gradle",
      "file:android/app/src/main/AndroidManifest.xml",
      "file:android/app/src/main/java/dev/alepha/mobile/MainActivity.java",
      "file:android/build.gradle",
    ]);
  });

  it("lists the platform packages and the installed plugins, nothing else", async ({
    expect,
  }) => {
    const { compute } = await setup();

    const packages = Object.keys((await compute("ios")).inputs)
      .filter((key) => key.startsWith("package:"))
      .sort();

    expect(packages).toEqual([
      "package:@capacitor/core",
      "package:@capacitor/haptics",
      "package:@capacitor/ios",
    ]);
  });

  it("moves when a native file or a plugin version moves", async ({
    expect,
  }) => {
    const { fs, compute } = await setup();
    const before = (await compute()).fingerprint;

    await fs.writeFile(`${ROOT}/android/build.gradle`, "buildscript { x }");
    const afterGradle = (await compute()).fingerprint;
    expect(afterGradle).not.toBe(before);

    await fs.writeFile(
      "/node_modules/@capacitor/haptics/package.json",
      JSON.stringify({ version: "8.0.3", capacitor: {} }),
    );
    expect((await compute()).fingerprint).not.toBe(afterGradle);
  });

  it("does not move for the lockfile, the web layer or an icon", async ({
    expect,
  }) => {
    const { fs, compute } = await setup();
    const before = (await compute("ios")).fingerprint;

    await fs.writeFile(`${ROOT}/yarn.lock`, "lodash@4");
    await fs.writeFile(`${ROOT}/ios/App/App/public/index.html`, "<html>2");
    await fs.writeFile(
      `${ROOT}/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`,
      "{ }",
    );

    expect((await compute("ios")).fingerprint).toBe(before);
  });
});

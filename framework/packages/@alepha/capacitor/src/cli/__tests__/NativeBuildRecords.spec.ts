import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import type { CapacitorBuildRecord } from "../schemas/capacitorBuildRecordSchema.ts";
import { NativeBuildRecords } from "../services/NativeBuildRecords.ts";
import { seedNativeProject } from "./memoryProject.ts";

const ROOT = "/app";

const setup = async () => {
  const alepha = Alepha.create().with({
    provide: FileSystemProvider,
    use: MemoryFileSystemProvider,
  });
  const fs = alepha.inject(MemoryFileSystemProvider);
  await seedNativeProject(fs, ROOT);
  return { fs, records: alepha.inject(NativeBuildRecords) };
};

const record = (
  overrides: Partial<CapacitorBuildRecord> = {},
): CapacitorBuildRecord => ({
  appId: "dev.alepha.mobile",
  platform: "android",
  versionBuild: "1",
  variant: "base",
  configuration: "debug",
  fingerprint: "aaa",
  inputs: {
    "file:android/app/build.gradle": "1",
    "package:@capacitor/core": "8.5.2",
  },
  signing: "debug",
  artifact: { path: "app.apk", sha256: "f00" },
  builtAt: "2026-10-04T00:00:00.000Z",
  ...overrides,
});

describe("NativeBuildRecords", () => {
  describe("versionBuild", () => {
    it("reads iOS CURRENT_PROJECT_VERSION and Android versionCode", async ({
      expect,
    }) => {
      const { records } = await setup();

      expect(await records.versionBuild(ROOT, "ios")).toBe("1");
      expect(await records.versionBuild(ROOT, "android")).toBe("1");
    });

    it("refuses an Android versionCode that is missing or not an integer", async ({
      expect,
    }) => {
      const { fs, records } = await setup();
      await fs.writeFile(`${ROOT}/android/app/build.gradle`, "android {}");
      await expect(records.versionBuild(ROOT, "android")).rejects.toThrow(
        /integer versionCode/,
      );

      await fs.writeFile(
        `${ROOT}/android/app/build.gradle`,
        "    versionCode rootProject.ext.code\n",
      );
      await expect(records.versionBuild(ROOT, "android")).rejects.toThrow(
        /not rootProject\.ext\.code/,
      );
    });

    it("refuses iOS configurations that disagree on the build number", async ({
      expect,
    }) => {
      const { fs, records } = await setup();
      await fs.writeFile(
        `${ROOT}/ios/App/App.xcodeproj/project.pbxproj`,
        "CURRENT_PROJECT_VERSION = 1;\nCURRENT_PROJECT_VERSION = 2;\n",
      );

      await expect(records.versionBuild(ROOT, "ios")).rejects.toThrow(
        /several CURRENT_PROJECT_VERSION/,
      );
    });
  });

  describe("check", () => {
    it("answers new for an unknown key and known for the same inputs", async ({
      expect,
    }) => {
      const { records } = await setup();
      const existing = [record()];

      expect(records.check(existing, { ...record(), versionBuild: "2" })).toBe(
        "new",
      );
      expect(records.check(existing, record())).toBe("known");
    });

    it("refuses a known key from other inputs, naming what moved", async ({
      expect,
    }) => {
      const { records } = await setup();
      const moved = record({
        fingerprint: "bbb",
        inputs: {
          "file:android/app/build.gradle": "2",
          "package:@capacitor/core": "8.5.2",
        },
      });

      expect(() => records.check([record()], moved)).toThrow(
        /Bump the native build number \(versionCode\).*file:android\/app\/build\.gradle/,
      );
    });
  });

  it("appends without touching what was recorded before", async ({
    expect,
  }) => {
    const { records } = await setup();
    await records.append(ROOT, record());
    await records.append(ROOT, record({ versionBuild: "2", fingerprint: "c" }));

    const all = await records.read(ROOT);
    expect(all.map((r) => r.versionBuild)).toEqual(["1", "2"]);
    expect(all[0]).toEqual(record());
  });
});

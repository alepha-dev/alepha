import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";

import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";
import {
  type CapacitorBuildRecord,
  capacitorBuildRecordSchema,
} from "../schemas/capacitorBuildRecordSchema.ts";

/**
 * `capacitor.builds.json`: every native binary `alepha capacitor build`
 * produced, beside `capacitor.config.ts` and tracked in git, so any machine
 * that later publishes a web layer sees the same set of binaries it may run
 * on.
 *
 * Written by `build` only, after the native build succeeded. `sync` and
 * `dev` never write here: a binary that was not built here, or a
 * live-reload binary that never receives a bundle, has nothing to record.
 */
export class NativeBuildRecords {
  public static readonly FILE = "capacitor.builds.json";

  protected readonly fs = $inject(FileSystemProvider);

  /**
   * The build number the stores read, from the native project itself: iOS
   * `CURRENT_PROJECT_VERSION`, Android `versionCode`. The plugin does not own
   * version numbers; bumping one is a native change and happens there.
   */
  public async versionBuild(
    root: string,
    platform: CapacitorPlatform,
  ): Promise<string> {
    if (platform === "ios") {
      const path = this.fs.join(root, "ios/App/App.xcodeproj/project.pbxproj");
      const pbxproj = await this.fs.readTextFile(path);
      const values = new Set(
        [...pbxproj.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(
          (match) => match[1].trim().replace(/^"|"$/g, ""),
        ),
      );
      if (values.size !== 1) {
        throw new AlephaError(
          values.size === 0
            ? "ios/App/App.xcodeproj sets no CURRENT_PROJECT_VERSION. Set the build number in Xcode (target App, General, Build)."
            : `ios/App/App.xcodeproj sets several CURRENT_PROJECT_VERSION values (${[...values].join(", ")}). Give every configuration the same build number.`,
        );
      }
      return [...values][0];
    }

    const gradle = await this.fs.readTextFile(
      this.fs.join(root, "android/app/build.gradle"),
    );
    const match = gradle.match(/^\s*versionCode\s+(\S+)/m);
    if (!match || !/^\d+$/.test(match[1])) {
      throw new AlephaError(
        `android/app/build.gradle needs an integer versionCode in defaultConfig${match ? `, not ${match[1]}` : ""}.`,
      );
    }
    return match[1];
  }

  public async read(root: string): Promise<CapacitorBuildRecord[]> {
    const path = this.path(root);
    if (!(await this.fs.exists(path))) {
      return [];
    }
    let parsed: { records?: unknown[] };
    try {
      parsed = JSON.parse(await this.fs.readTextFile(path));
    } catch {
      throw new AlephaError(
        `${NativeBuildRecords.FILE} is not valid JSON. Restore it from git.`,
      );
    }
    return (parsed.records ?? []).map((record) =>
      capacitorBuildRecordSchema.parse(record),
    );
  }

  /**
   * Whether a build under this key may go ahead: `new` when the key was never
   * built, `known` when it was, from the same inputs. Refused when it was
   * built from other inputs, naming the inputs that moved.
   */
  public check(
    records: CapacitorBuildRecord[],
    candidate: {
      appId: string;
      platform: CapacitorPlatform;
      versionBuild: string;
      fingerprint: string;
      inputs: Record<string, string>;
    },
  ): "new" | "known" {
    const existing = records.find(
      (record) =>
        record.appId === candidate.appId &&
        record.platform === candidate.platform &&
        record.versionBuild === candidate.versionBuild,
    );
    if (!existing) {
      return "new";
    }
    if (existing.fingerprint === candidate.fingerprint) {
      return "known";
    }

    const keys = new Set([
      ...Object.keys(existing.inputs),
      ...Object.keys(candidate.inputs),
    ]);
    const moved = [...keys]
      .filter((key) => existing.inputs[key] !== candidate.inputs[key])
      .sort();
    throw new AlephaError(
      `${candidate.platform} build ${candidate.versionBuild} of ${candidate.appId} was already built from other native inputs. Bump the native build number (${candidate.platform === "ios" ? "CURRENT_PROJECT_VERSION" : "versionCode"}), then build again. Changed: ${moved.join(", ")}.`,
    );
  }

  /**
   * Append one record. Never rewrites an existing one.
   */
  public async append(
    root: string,
    record: CapacitorBuildRecord,
  ): Promise<void> {
    const records = await this.read(root);
    records.push(capacitorBuildRecordSchema.parse(record));
    await this.fs.writeFile(
      this.path(root),
      `${JSON.stringify({ records }, null, 2)}\n`,
    );
  }

  protected path(root: string): string {
    return this.fs.join(root, NativeBuildRecords.FILE);
  }
}

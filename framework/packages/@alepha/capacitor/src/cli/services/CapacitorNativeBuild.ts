import { $inject, Alepha, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import type {
  CapacitorOptions,
  CapacitorPlatform,
} from "../atoms/capacitorOptions.ts";
import { CapacitorProject } from "./CapacitorProject.ts";
import { CapacitorSync } from "./CapacitorSync.ts";
import { NativeBuildRecords } from "./NativeBuildRecords.ts";
import { NativeFingerprint } from "./NativeFingerprint.ts";
import { NativeGuard } from "./NativeGuard.ts";

/**
 * `alepha capacitor build <platform>`: a native binary of the app.
 *
 * Always syncs first, because a web-only sync never reaches an installed
 * binary: the binary is what carries the shell. Then compiles:
 *
 * - **debug** (the default), installable without any store: on Android an
 *   APK from `./gradlew assembleDebug` (signed with the debug key, honouring
 *   a `debug-overrides` network security config); on iOS an `.app` from
 *   `xcodebuild`, for the simulator, or with `--device` for a phone signed by
 *   `iosTeamId` (a free personal team is enough, the signature lasts 7 days);
 * - **release** (`--release`), through `cap build` with explicit signing: on
 *   Android a signed AAB or APK from a keystore named in the environment; on
 *   iOS an IPA, exported with `--export-method` (`debugging` by default, NOT
 *   cap's own `app-store-connect`, so the free-account path never tries a
 *   store export).
 *
 * Nothing is submitted to a store. A successful build appends its record to
 * `capacitor.builds.json`; the build number comes from the native project,
 * and one already recorded from other native inputs is refused before
 * anything compiles.
 *
 * Signing secrets are read from the environment and passed as argument
 * arrays, never through a shell, and masked wherever a command is printed:
 * `CAPACITOR_ANDROID_KEYSTORE_PATH`, `CAPACITOR_ANDROID_KEYSTORE_PASSWORD`,
 * `CAPACITOR_ANDROID_KEY_ALIAS`, `CAPACITOR_ANDROID_KEY_PASSWORD`.
 */
export class CapacitorNativeBuild {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly project = $inject(CapacitorProject);
  protected readonly sync = $inject(CapacitorSync);
  protected readonly guard = $inject(NativeGuard);
  protected readonly fingerprint = $inject(NativeFingerprint);
  protected readonly records = $inject(NativeBuildRecords);

  public async run(opts: {
    root: string;
    run: RunnerMethod;
    platform: CapacitorPlatform;
    release?: boolean;
    device?: boolean;
    exportMethod?: string;
    androidReleaseType?: "AAB" | "APK";
  }): Promise<void> {
    const { root, run, platform } = opts;
    const options = this.project.options();

    if (platform === "ios" && this.hostPlatform() !== "darwin") {
      throw new AlephaError(
        "An iOS build needs macOS and Xcode. Build the Android app here, or run this on a Mac.",
      );
    }
    if (!(await this.fs.exists(this.project.platformDir(root, platform)))) {
      throw new AlephaError(
        `There is no ${platform}/ project. Run alepha capacitor init first.`,
      );
    }

    const signing = this.signing(opts, options);

    // Before the sync, which would erase the evidence a dev run left behind.
    await this.guard.assertClean(root, [platform], "before sync");

    const versionBuild = await this.records.versionBuild(root, platform);
    const identity = {
      appId: options.appId,
      appName: options.appName,
      scheme: options.scheme,
      variant: this.project.variant(),
    };
    const { fingerprint, inputs } = await this.fingerprint.compute({
      root,
      platform,
      identity,
    });
    const status = this.records.check(await this.records.read(root), {
      appId: options.appId,
      platform,
      versionBuild,
      variant: this.project.variant(),
      fingerprint,
      inputs,
    });

    await this.sync.run({ root, run, platforms: [platform] });

    const artifact = await this.compile(opts, options, signing);

    if (status === "known") {
      this.log.info(
        `${platform} build ${versionBuild} is already recorded from these inputs; nothing appended.`,
      );
      return;
    }

    await this.records.append(root, {
      appId: options.appId,
      platform,
      versionBuild,
      variant: this.project.variant(),
      configuration: opts.release ? "release" : "debug",
      fingerprint,
      inputs,
      signing: signing.label,
      artifact: {
        path: artifact,
        sha256: await this.fingerprint.hashArtifact(
          this.fs.join(root, artifact),
        ),
      },
      builtAt: this.dateTime.nowISOString(),
    });
    this.log.info(`Built ${artifact} (${platform} build ${versionBuild}).`);
  }

  /**
   * The operating system this command runs on. A method so a spec can answer
   * for another host.
   */
  protected hostPlatform(): NodeJS.Platform {
    return process.platform;
  }

  /**
   * What signs this build, read before anything runs so a missing secret
   * fails first.
   */
  protected signing(
    opts: { platform: CapacitorPlatform; release?: boolean; device?: boolean },
    options: CapacitorOptions,
  ): { label: string; android?: AndroidSigning } {
    if (opts.platform === "ios") {
      if (opts.release || opts.device) {
        if (!options.iosTeamId) {
          throw new AlephaError(
            "Signing an iOS build for a device needs the Apple team: set capacitor({ iosTeamId }) in alepha.config.ts (Xcode > Settings > Accounts shows it).",
          );
        }
        return { label: `team:${options.iosTeamId}` };
      }
      return { label: "debug" };
    }

    if (!opts.release) {
      return { label: "debug" };
    }

    const env = (key: string) => {
      const value = this.alepha.env[key as keyof typeof this.alepha.env];
      return value === undefined || value === "" ? undefined : String(value);
    };
    const android: AndroidSigning = {
      keystorePath: env("CAPACITOR_ANDROID_KEYSTORE_PATH") ?? "",
      keystorePassword: env("CAPACITOR_ANDROID_KEYSTORE_PASSWORD") ?? "",
      keyAlias: env("CAPACITOR_ANDROID_KEY_ALIAS") ?? "",
      keyPassword: env("CAPACITOR_ANDROID_KEY_PASSWORD") ?? "",
    };
    const missing = Object.entries({
      CAPACITOR_ANDROID_KEYSTORE_PATH: android.keystorePath,
      CAPACITOR_ANDROID_KEYSTORE_PASSWORD: android.keystorePassword,
      CAPACITOR_ANDROID_KEY_ALIAS: android.keyAlias,
      CAPACITOR_ANDROID_KEY_PASSWORD: android.keyPassword,
    })
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length > 0) {
      throw new AlephaError(
        `A release Android build is signed with your upload keystore. Set ${missing.join(", ")} in the environment (never in alepha.config.ts).`,
      );
    }
    return { label: `keystore:${android.keyAlias}`, android };
  }

  /**
   * Compile, and answer the artifact's path relative to the root.
   */
  protected async compile(
    opts: {
      root: string;
      run: RunnerMethod;
      platform: CapacitorPlatform;
      release?: boolean;
      device?: boolean;
      exportMethod?: string;
      androidReleaseType?: "AAB" | "APK";
    },
    options: CapacitorOptions,
    signing: { label: string; android?: AndroidSigning },
  ): Promise<string> {
    const { root, run, platform } = opts;

    if (platform === "android" && !opts.release) {
      await run({
        name: "gradle assembleDebug",
        handler: async () => {
          await this.shell.run(["./gradlew", "assembleDebug"], {
            root: this.fs.join(root, "android"),
          });
        },
      });
      return "android/app/build/outputs/apk/debug/app-debug.apk";
    }

    if (platform === "android") {
      const s = signing.android as AndroidSigning;
      const type = opts.androidReleaseType ?? "AAB";
      await run({
        name: `cap build android (${type})`,
        handler: async () => {
          await this.shell.run(
            [
              "cap",
              "build",
              "android",
              "--androidreleasetype",
              type,
              "--signing-type",
              "apksigner",
              "--keystorepath",
              s.keystorePath,
              "--keystorepass",
              s.keystorePassword,
              "--keystorealias",
              s.keyAlias,
              "--keystorealiaspass",
              s.keyPassword,
            ],
            // `resolve`: the app's own `cap` from node_modules/.bin, run as an
            // argument array, so the passwords on this line never meet a shell.
            {
              root,
              resolve: true,
              redact: [s.keystorePassword, s.keyPassword],
            },
          );
        },
      });
      return type === "AAB"
        ? "android/app/build/outputs/bundle/release/app-release-signed.aab"
        : "android/app/build/outputs/apk/release/app-release-signed.apk";
    }

    if (!opts.release) {
      const sdk = opts.device ? "iphoneos" : "iphonesimulator";
      await run({
        name: `xcodebuild (${sdk})`,
        handler: async () => {
          await this.shell.run(
            [
              "xcodebuild",
              "-project",
              "App.xcodeproj",
              "-scheme",
              "App",
              "-configuration",
              "Debug",
              "-sdk",
              sdk,
              "-destination",
              opts.device
                ? "generic/platform=iOS"
                : "generic/platform=iOS Simulator",
              "-derivedDataPath",
              "build",
              ...(opts.device
                ? [
                    "-allowProvisioningUpdates",
                    `DEVELOPMENT_TEAM=${options.iosTeamId}`,
                  ]
                : []),
              "build",
            ],
            { root: this.fs.join(root, "ios", "App") },
          );
        },
      });
      return `ios/App/build/Build/Products/Debug-${sdk}/App.app`;
    }

    await run({
      name: "cap build ios",
      handler: async () => {
        await this.shell.run(
          [
            "cap",
            "build",
            "ios",
            "--scheme",
            "App",
            "--configuration",
            "Release",
            "--xcode-team-id",
            options.iosTeamId as string,
            "--xcode-signing-style",
            "automatic",
            "--xcode-export-method",
            opts.exportMethod ?? "debugging",
          ],
          { root, resolve: true },
        );
      },
    });
    return "ios/App/output/App.ipa";
  }
}

/**
 * An Android upload key, read from the environment for one build.
 */
interface AndroidSigning {
  keystorePath: string;
  keystorePassword: string;
  keyAlias: string;
  keyPassword: string;
}

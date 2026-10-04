import { $inject, AlephaError, z } from "alepha";
import { PackageManagerUtils } from "alepha/cli";
import { $command } from "alepha/command";

import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";
import { CapacitorInit } from "../services/CapacitorInit.ts";
import { CapacitorNativeBuild } from "../services/CapacitorNativeBuild.ts";
import { CapacitorPackages } from "../services/CapacitorPackages.ts";
import { CapacitorProject } from "../services/CapacitorProject.ts";
import { CapacitorSync } from "../services/CapacitorSync.ts";

/**
 * The `alepha capacitor` family: the native app of an Alepha project.
 */
export class CapacitorCommand {
  protected readonly initService = $inject(CapacitorInit);
  protected readonly syncService = $inject(CapacitorSync);
  protected readonly buildService = $inject(CapacitorNativeBuild);
  protected readonly project = $inject(CapacitorProject);
  protected readonly packages = $inject(CapacitorPackages);
  protected readonly pm = $inject(PackageManagerUtils);

  public readonly init = $command({
    name: "init",
    description:
      "Create the native iOS and Android projects from capacitor({ ... }) in alepha.config.ts",
    flags: z.object({
      platform: z
        .enum(["ios", "android"])
        .describe(
          "Only this platform, instead of every platform the config declares",
        )
        .optional(),
    }),
    handler: async ({ flags, run, root }) => {
      await this.initService.run({
        root,
        run,
        platforms: flags.platform
          ? [flags.platform as CapacitorPlatform]
          : undefined,
      });
    },
  });

  public readonly sync = $command({
    name: "sync",
    mode: "production",
    description:
      "Build the app shell into dist-capacitor/ and copy it into the native projects (an installed app is unchanged until rebuilt)",
    flags: z.object({
      webOnly: z
        .boolean()
        .meta({ aliases: ["web-only"] })
        .describe("Build the shell only, without touching the native projects")
        .optional(),
    }),
    handler: async ({ flags, run, root }) => {
      await this.syncService.run({ root, run, webOnly: flags.webOnly });
    },
  });

  public readonly build = $command({
    name: "build",
    mode: "production",
    description:
      "Sync, then compile a native binary (debug by default) and record it in capacitor.builds.json",
    args: z.text({ title: "platform" }),
    flags: z.object({
      release: z
        .boolean()
        .describe(
          "A signed release build through cap build, instead of a debug build",
        )
        .optional(),
      device: z
        .boolean()
        .describe(
          "iOS debug: build for a phone (signed with iosTeamId) instead of the simulator",
        )
        .optional(),
      exportMethod: z
        .enum([
          "debugging",
          "release-testing",
          "app-store-connect",
          "enterprise",
          "developer-id",
          "validation",
        ])
        .meta({ aliases: ["export-method"] })
        .describe(
          "iOS release: how the archive is exported (default: debugging)",
        )
        .optional(),
      androidReleaseType: z
        .enum(["AAB", "APK"])
        .meta({ aliases: ["android-release-type"] })
        .describe("Android release: bundle or APK (default: AAB)")
        .optional(),
    }),
    handler: async ({ args, flags, run, root }) => {
      await this.buildService.run({
        root,
        run,
        platform: this.platformOf(args),
        release: flags.release,
        device: flags.device,
        exportMethod: flags.exportMethod,
        androidReleaseType: flags.androidReleaseType as
          | "AAB"
          | "APK"
          | undefined,
      });
    },
  });

  public readonly open = $command({
    name: "open",
    description: "Open the native project in Xcode or Android Studio",
    args: z.text({ title: "platform" }),
    handler: async ({ args, run, root }) => {
      const platform = this.platformOf(args);
      this.project.options();
      const pm = await this.pm.getPackageManager(root);
      await run(this.packages.cap(pm, `open ${platform}`), {
        alias: `cap open ${platform}`,
        root,
      });
    },
  });

  public readonly capacitor = $command({
    name: "capacitor",
    description: "Build and run the native app (iOS and Android)",
    children: [this.init, this.sync, this.build, this.open],
    handler: async ({ help }) => {
      help();
    },
  });

  protected platformOf(value: string): CapacitorPlatform {
    if (value !== "ios" && value !== "android") {
      throw new AlephaError(`Unknown platform "${value}": use ios or android.`);
    }
    return value;
  }
}

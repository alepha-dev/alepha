import { $inject, z } from "alepha";
import { $command } from "alepha/command";

import type { CapacitorPlatform } from "../atoms/capacitorOptions.ts";
import { CapacitorInit } from "../services/CapacitorInit.ts";

/**
 * The `alepha capacitor` family: the native app of an Alepha project.
 */
export class CapacitorCommand {
  protected readonly initService = $inject(CapacitorInit);

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

  public readonly capacitor = $command({
    name: "capacitor",
    description: "Build and run the native app (iOS and Android)",
    children: [this.init],
    handler: async ({ help }) => {
      help();
    },
  });
}

import { $context, $module } from "alepha";
import { AlephaCli } from "alepha/cli";

import {
  type CapacitorOptions,
  capacitorOptions,
} from "./atoms/capacitorOptions.ts";
import { CapacitorCommand } from "./commands/CapacitorCommand.ts";
import { CapacitorInit } from "./services/CapacitorInit.ts";
import { CapacitorPackages } from "./services/CapacitorPackages.ts";
import { CapacitorProject } from "./services/CapacitorProject.ts";
import { NativeSchemes } from "./services/NativeSchemes.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/capacitorOptions.ts";
export * from "./commands/CapacitorCommand.ts";
export * from "./schemas/capacitorIdentitySchema.ts";
export * from "./services/CapacitorInit.ts";
export * from "./services/CapacitorPackages.ts";
export * from "./services/CapacitorProject.ts";
export * from "./services/NativeSchemes.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The `alepha capacitor` commands: native iOS and Android projects for an
 * Alepha app, and the app shell they run.
 *
 * Declared in `alepha.config.ts`, which the `alepha` CLI loads:
 *
 * ```ts
 * import { capacitor } from "@alepha/capacitor/cli";
 * import { defineConfig } from "alepha/cli/config";
 *
 * export default defineConfig({
 *   plugins: [
 *     capacitor({
 *       appId: "dev.alepha.mobile",
 *       appName: "Mobile",
 *       scheme: "mobile",
 *       apiUrl: "https://api.example.com",
 *     }),
 *   ],
 * });
 * ```
 *
 * Then `alepha capacitor init` creates `ios/` and `android/` (both checked
 * in), installs the pinned Capacitor packages and writes
 * `capacitor.config.ts`. `alepha capacitor --help` lists the family.
 *
 * Node only: this entry reaches the file system, the shell and the build
 * pipeline. Browser code imports `@alepha/capacitor` (the `core` entry).
 *
 * @module alepha.capacitor.cli
 */
export const AlephaCliCapacitorPlugin = $module({
  name: "alepha.cli.plugins.capacitor",
  services: [
    AlephaCli,
    CapacitorProject,
    CapacitorPackages,
    NativeSchemes,
    CapacitorInit,
    CapacitorCommand,
  ],
});

/**
 * Give this Alepha app a native shell. See {@link AlephaCliCapacitorPlugin}.
 *
 * Validated when the CLI loads the config, so a malformed `appId` or
 * `scheme` fails every command with the field named, before anything runs.
 */
export const capacitor = (options: CapacitorOptions) => {
  return () => {
    const { alepha } = $context();
    alepha.with(AlephaCliCapacitorPlugin).set(capacitorOptions, options);
  };
};

/**
 * The Alepha CLI core: `init`, `dev`, `build`, `verify`, `db`, `test`,
 * `lint`, `typecheck`, `gen` and `pack`. Loaded automatically when the
 * `alepha` binary runs; each command is documented in the CLI section of the
 * docs site.
 *
 * @module alepha.cli
 */
import { $module } from "alepha";

import { appEntryOptions } from "./atoms/appEntryOptions.ts";
import { buildOptions } from "./atoms/buildOptions.ts";
import { devOptions } from "./atoms/devOptions.ts";
import { metaOptions } from "./atoms/metaOptions.ts";
import { BuildCommand } from "./commands/build.ts";
import { CleanCommand } from "./commands/clean.ts";
import { DbCommand } from "./commands/db.ts";
import { DevCommand } from "./commands/dev.ts";
import { GenCommand } from "./commands/gen.ts";
import {
  changelogOptions,
  GitMessageParser,
  GitProvider,
} from "./commands/gen/changelog.ts";
import { InitCommand } from "./commands/init.ts";
import { LintCommand } from "./commands/lint.ts";
import { PackCommand } from "./commands/pack.ts";
import { RootCommand } from "./commands/root.ts";
import { TestCommand } from "./commands/test.ts";
import { TypecheckCommand } from "./commands/typecheck.ts";
import { VerifyCommand } from "./commands/verify.ts";
import { AlephaCliExtensionProvider } from "./providers/AlephaCliExtensionProvider.ts";
import { AppEntryProvider } from "./providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "./providers/ViteBuildProvider.ts";
import { ViteDevServerProvider } from "./providers/ViteDevServerProvider.ts";
import { AlephaCliUtils } from "./services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "./services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "./services/ProjectScaffolder.ts";
import { ViteUtils } from "./services/ViteUtils.ts";
import { WorkspacePacker } from "./services/WorkspacePacker.ts";
import { BuildAssetsTask } from "./tasks/BuildAssetsTask.ts";
import { BuildClientTask } from "./tasks/BuildClientTask.ts";
import { BuildCloudflareTask } from "./tasks/BuildCloudflareTask.ts";
import { BuildCompressTask } from "./tasks/BuildCompressTask.ts";
import { BuildDockerTask } from "./tasks/BuildDockerTask.ts";
import { BuildManifestTask } from "./tasks/BuildManifestTask.ts";
import { BuildPrerenderTask } from "./tasks/BuildPrerenderTask.ts";
import { BuildPwaTask } from "./tasks/BuildPwaTask.ts";
import { BuildServerTask } from "./tasks/BuildServerTask.ts";
import { BuildStaticTask } from "./tasks/BuildStaticTask.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./alephaPackageJson.ts";
export * from "./atoms/appEntryOptions.ts";
export * from "./atoms/buildOptions.ts";
export * from "./atoms/changelogOptions.ts";
export * from "./atoms/devOptions.ts";
export * from "./atoms/metaOptions.ts";
export * from "./commands/build.ts";
export * from "./commands/clean.ts";
export * from "./commands/db.ts";
export * from "./commands/dev.ts";
export * from "./commands/gen/changelog.ts";
export * from "./commands/gen/openapi.ts";
export * from "./commands/init.ts";
export * from "./commands/lint.ts";
export * from "./commands/pack.ts";
export * from "./commands/root.ts";
export * from "./commands/test.ts";
export * from "./commands/typecheck.ts";
export * from "./commands/verify.ts";
export * from "./providers/AlephaCliExtensionProvider.ts";
export * from "./providers/AppEntryProvider.ts";
export * from "./providers/ViteBuildProvider.ts";
export * from "./providers/ViteDevServerProvider.ts";
export * from "./schemas/buildManifest.ts";
export * from "./schemas/presetSchema.ts";
export * from "./services/AlephaCliUtils.ts";
export * from "./services/GitMessageParser.ts";
export * from "./services/PackageManagerUtils.ts";
export * from "./services/ProjectScaffolder.ts";
export * from "./services/ViteUtils.ts";
export * from "./services/WorkspacePacker.ts";
export * from "./tasks/BuildAssetsTask.ts";
export * from "./tasks/BuildClientTask.ts";
export * from "./tasks/BuildCloudflareTask.ts";
export * from "./tasks/BuildCompressTask.ts";
export * from "./tasks/BuildDockerTask.ts";
export * from "./tasks/BuildManifestTask.ts";
export * from "./tasks/BuildPrerenderTask.ts";
export * from "./tasks/BuildPwaTask.ts";
export * from "./tasks/BuildServerTask.ts";
export * from "./tasks/BuildStaticTask.ts";
export * from "./tasks/BuildTask.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Services, providers, and build tasks — no commands.
 * Use this module when you need CLI utilities without registering commands.
 *
 * ⚠️ **The build tasks live here rather than in {@link AlephaCli}, and that is
 * the whole point of the split.** `Alepha.inject` registers the module that
 * DECLARES a service, through the `[MODULE]` back-reference, so a task
 * declared beside the commands would drag all twenty-five of them into any
 * container that injected one. `lore apps build` needs
 * {@link BuildCloudflareTask}; declared in `AlephaCli` that would grow the
 * `lore` binary a `build`, a `dev`, a `db` and a `verify` under a second name
 * and a second release cadence. `@alepha/lore`'s `commandSurface.spec.ts` is
 * the guard, and `commandSurface` here is the framework-side half.
 *
 * Neither obvious escape works, which is why the fix is which module declares
 * what: `getTopLevelCommands` subtracts by `children`, so hiding a command
 * that way republishes it one level down, and `hide` is read only by the help
 * renderer, so a hidden command still executes.
 *
 * ⚠️ Command-free is not the same as bundle-safe. This module still holds
 * `ViteBuildProvider`, so importing from it reaches Vite and `node:` builtins.
 * A Worker-safe entry point is #1513's job, not this split's.
 */
export const AlephaCliServices = $module({
  name: "alepha.cli.services",
  // The tasks resolve `buildOptions`, so it belongs to whichever module
  // declares them. Left behind on `AlephaCli` it would read as unregistered
  // from a container that has the tasks and not the commands.
  atoms: [buildOptions],
  services: [
    // Services & providers
    AlephaCliUtils,
    PackageManagerUtils,
    ViteUtils,
    ProjectScaffolder,
    AppEntryProvider,
    GitMessageParser,
    GitProvider,
    ViteDevServerProvider,
    ViteBuildProvider,
    WorkspacePacker,
    // Build tasks. `BuildCommand` orchestrates these and stays in `AlephaCli`:
    // it is a command, and it is the thing nobody outside the CLI wants.
    BuildAssetsTask,
    BuildClientTask,
    BuildCloudflareTask,
    BuildCompressTask,
    BuildDockerTask,
    BuildManifestTask,
    BuildPrerenderTask,
    BuildServerTask,
    BuildPwaTask,
    BuildStaticTask,
  ],
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Full CLI module — all services and commands.
 *
 * It imports {@link AlephaCliServices} explicitly rather than picking it up
 * through whichever service happens to inject one of its members, so `alepha
 * build` keeps every task and the `buildOptions` atom whatever the tasks are
 * refactored into later.
 */
export const AlephaCli = $module({
  name: "alepha.cli",
  imports: [AlephaCliServices],
  atoms: [appEntryOptions, changelogOptions, devOptions, metaOptions],
  services: [
    AlephaCliExtensionProvider,
    // Commands
    BuildCommand,
    CleanCommand,
    DbCommand,
    DevCommand,
    InitCommand,
    LintCommand,
    PackCommand,
    RootCommand,
    TestCommand,
    TypecheckCommand,
    VerifyCommand,
    GenCommand,
  ],
});

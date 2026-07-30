import { $module } from "alepha";
import { appEntryOptions } from "./atoms/appEntryOptions.ts";
import { buildOptions } from "./atoms/buildOptions.ts";
import { devOptions } from "./atoms/devOptions.ts";
import { BuildCommand } from "./commands/build.ts";
import { CleanCommand } from "./commands/clean.ts";
import { DbCommand } from "./commands/db.ts";
import { DevCommand } from "./commands/dev.ts";
import {
  changelogOptions,
  GitMessageParser,
  GitProvider,
} from "./commands/gen/changelog.ts";
import { GenCommand } from "./commands/gen.ts";
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
import { BuildVercelTask } from "./tasks/BuildVercelTask.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./alephaPackageJson.ts";
export * from "./atoms/appEntryOptions.ts";
export * from "./atoms/buildOptions.ts";
export * from "./atoms/changelogOptions.ts";
export * from "./atoms/devOptions.ts";
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
export * from "./services/AlephaCliUtils.ts";
export * from "./services/GitMessageParser.ts";
export * from "./services/PackageManagerUtils.ts";
export * from "./services/ProjectScaffolder.ts";
export * from "./services/ViteUtils.ts";
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
export * from "./tasks/BuildVercelTask.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Services, providers, and build tasks — no commands.
 * Use this module when you need CLI utilities without registering commands.
 */
export const AlephaCliServices = $module({
  name: "alepha.cli.services",
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
  ],
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Full CLI module — all services and commands.
 */
export const AlephaCli = $module({
  name: "alepha.cli",
  atoms: [appEntryOptions, buildOptions, changelogOptions, devOptions],
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
    // Build tasks
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
    BuildVercelTask,
  ],
});

import { $module } from "alepha";
import { BuildCommand } from "../commands/build.ts";
import { CleanCommand } from "../commands/clean.ts";
import { DbCommand } from "../commands/db.ts";
import { DevCommand } from "../commands/dev.ts";
import { GitProvider } from "../commands/gen/changelog.ts";
import { GenCommand } from "../commands/gen.ts";
import { InitCommand } from "../commands/init.ts";
import { LintCommand } from "../commands/lint.ts";
import { PlatformCommand } from "../commands/platform.ts";
import { RootCommand } from "../commands/root.ts";
import { TestCommand } from "../commands/test.ts";
import { TypecheckCommand } from "../commands/typecheck.ts";
import { VerifyCommand } from "../commands/verify.ts";
import { CloudflareAdapter } from "../platform/adapters/CloudflareAdapter.ts";
import { PlatformCacheProvider } from "../platform/providers/PlatformCacheProvider.ts";
import { NamingService } from "../platform/services/NamingService.ts";
import { PlatformInspector } from "../platform/services/PlatformInspector.ts";
import { PlatformOrchestrator } from "../platform/services/PlatformOrchestrator.ts";
import { AlephaCliExtensionProvider } from "../providers/AlephaCliExtensionProvider.ts";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { BuildAssetsTask } from "../tasks/BuildAssetsTask.ts";
import { BuildClientTask } from "../tasks/BuildClientTask.ts";
import { BuildCloudflareTask } from "../tasks/BuildCloudflareTask.ts";
import { BuildCompressTask } from "../tasks/BuildCompressTask.ts";
import { BuildDockerTask } from "../tasks/BuildDockerTask.ts";
import { BuildPrerenderTask } from "../tasks/BuildPrerenderTask.ts";
import { BuildServerTask } from "../tasks/BuildServerTask.ts";
import { BuildSitemapTask } from "../tasks/BuildSitemapTask.ts";
import { BuildStaticTask } from "../tasks/BuildStaticTask.ts";
import { BuildVercelTask } from "../tasks/BuildVercelTask.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaCli = $module({
  name: "alepha.cli",
  services: [
    AlephaCliExtensionProvider,
    // Commands (one per file)
    BuildCommand,
    CleanCommand,
    DbCommand,
    DevCommand,
    InitCommand,
    LintCommand,
    RootCommand,
    TestCommand,
    TypecheckCommand,
    VerifyCommand,
    GenCommand,
    PlatformCommand,
    // Platform services
    CloudflareAdapter,
    PlatformCacheProvider,
    NamingService,
    PlatformInspector,
    PlatformOrchestrator,
    // Support services
    AppEntryProvider,
    GitProvider,
    // Build tasks
    BuildAssetsTask,
    BuildClientTask,
    BuildCloudflareTask,
    BuildCompressTask,
    BuildDockerTask,
    BuildPrerenderTask,
    BuildServerTask,
    BuildSitemapTask,
    BuildStaticTask,
    BuildVercelTask,
  ],
});

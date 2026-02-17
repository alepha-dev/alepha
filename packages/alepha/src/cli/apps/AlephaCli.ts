import { pathToFileURL } from "node:url";
import { $hook, $inject, $module, Alepha } from "alepha";
import { FileSystemProvider } from "alepha/system";
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

/**
 * Allow to extend Alepha CLI via `alepha.config.ts` file located in the project root.
 */

class AlephaCliExtension {
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      const root = process.cwd();
      const extensionPath = this.fs.join(root, "alepha.config.ts");
      const hasExtension = await this.fs.exists(extensionPath);
      if (!hasExtension) {
        return;
      }

      // import (use file:// URL for Windows compatibility)
      const extensionUrl = pathToFileURL(extensionPath).href;
      const { default: Extension } = await import(extensionUrl);
      if (typeof Extension !== "function") {
        return;
      }

      this.alepha.inject(Extension, {
        args: [this.alepha],
      });
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaCli = $module({
  name: "alepha.cli",
  services: [
    AlephaCliExtension,
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

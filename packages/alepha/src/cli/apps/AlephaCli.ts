import { join } from "node:path";
import { $hook, $inject, $module, Alepha } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { BuildCommand } from "../commands/build.ts";
import { CleanCommand } from "../commands/clean.ts";
import { DbCommand } from "../commands/db.ts";
import { DeployCommand } from "../commands/deploy.ts";
import { DevCommand } from "../commands/dev.ts";
import { FormatCommand } from "../commands/format.ts";
import { GitProvider } from "../commands/gen/changelog.ts";
import { GenCommand } from "../commands/gen.ts";
import { InitCommand } from "../commands/init.ts";
import { LintCommand } from "../commands/lint.ts";
import { RootCommand } from "../commands/root.ts";
import { RunCommand } from "../commands/run.ts";
import { TestCommand } from "../commands/test.ts";
import { TypecheckCommand } from "../commands/typecheck.ts";
import { VerifyCommand } from "../commands/verify.ts";

class AlephaCliExtension {
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      const root = process.cwd();
      const extensionPath = join(root, "alepha.config.ts");
      const hasExtension = await this.fs.exists(extensionPath);
      if (!hasExtension) {
        return;
      }

      // import
      const { default: Extension } = await import(extensionPath);
      if (typeof Extension !== "function") {
        return;
      }

      this.alepha.inject(Extension, {
        args: [this.alepha],
      });
    },
  });
}

export const AlephaCli = $module({
  name: "alepha.cli",
  services: [
    AlephaCliExtension,
    // Commands (one per file)
    BuildCommand,
    CleanCommand,
    DbCommand,
    DeployCommand,
    DevCommand,
    FormatCommand,
    InitCommand,
    LintCommand,
    RootCommand,
    RunCommand,
    TestCommand,
    TypecheckCommand,
    VerifyCommand,
    GenCommand,
    // Support services
    GitProvider,
  ],
});

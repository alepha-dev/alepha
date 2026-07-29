import { $inject, $state, AlephaError, z } from "alepha";
import { PackageManagerUtils } from "alepha/cli";
import { $command } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { vendorOptions } from "../atoms/vendorOptions.ts";
import type {
  VendorDiffResult,
  VendorPackageDiff,
  VendorSyncResult,
} from "../services/VendorService.ts";
import { VendorService } from "../services/VendorService.ts";

/**
 * Default remote when none is configured. The HTTPS URL is used so anyone
 * (CI runners, AI agents, contributors without SSH keys) can clone without
 * extra setup.
 */
const DEFAULT_REMOTE = "https://github.com/feunard/alepha";

export class VendorCommand {
  protected readonly log = $logger();
  protected readonly options = $state(vendorOptions);
  protected readonly vendorService = $inject(VendorService);
  protected readonly color = $inject(ConsoleColorProvider);
  protected readonly pm = $inject(PackageManagerUtils);

  /**
   * Ensure vendor config is present and return resolved options.
   */
  protected resolveOptions() {
    if (!this.options) {
      throw new AlephaError(
        "Missing vendor configuration. Register vendor({ packages: [...] }) from alepha/cli/vendor in the plugins of alepha.config.ts.",
      );
    }
    return {
      remote: this.options.remote ?? DEFAULT_REMOTE,
      branch: this.options.branch ?? "main",
      dir: this.options.dir ?? ".vendor",
      packages: this.options.packages,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // alepha vendor sync
  // ─────────────────────────────────────────────────────────────────────────

  protected readonly syncFlags = z.object({
    force: z
      .boolean()
      .meta({ aliases: ["f"] })
      .describe("Skip local modification check")
      .optional(),
    remote: z
      .text({
        description:
          "Override the configured remote for this invocation. Accepts any git-clone URL, including local paths (`file:///abs/path/to/alepha`). Useful for CI canaries that need to sync against a local checkout instead of the published repo.",
      })
      .optional(),
  });

  protected readonly sync = $command({
    name: "sync",
    description: "Replace local packages with remote source",
    flags: this.syncFlags,
    handler: async ({ flags, root, run }) => {
      const opts = this.resolveOptions();
      const remote = flags.remote ?? opts.remote;
      const c = this.color;

      let result: VendorSyncResult = { synced: [], errors: [] };

      await run({
        name: `Syncing from ${opts.branch}`,
        handler: async () => {
          result = await this.vendorService.sync({
            root,
            remote,
            branch: opts.branch,
            dir: opts.dir,
            packages: opts.packages,
            force: flags.force,
          });
        },
      });

      if (result.aborted) {
        run.end();

        process.stdout.write(
          `\nLocal modifications detected. Use ${c.set("CYAN", "--force")} to overwrite.\n`,
        );

        for (const pkg of result.aborted.packages) {
          this.printPackageDiff(pkg);
        }

        process.stdout.write("\n");
        return;
      }

      if (result.synced.length > 0) {
        const pmName = await this.pm.getPackageManager(root);
        await run(`${pmName} install`, { root });
      }

      run.end();

      if (result.errors.length > 0) {
        for (const error of result.errors) {
          process.stdout.write(`${c.set("RED", "  error")} ${error}\n`);
        }
      }

      if (result.synced.length > 0) {
        process.stdout.write(
          `\nSynced ${c.set("CYAN", String(result.synced.length))} ${result.synced.length === 1 ? "package" : "packages"} from ${c.set("CYAN", opts.branch)}\n`,
        );
        for (const pkg of result.synced) {
          process.stdout.write(`  ${c.set("GREEN", "\u2713")} ${pkg}\n`);
        }
      }

      process.stdout.write("\n");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // alepha vendor diff
  // ─────────────────────────────────────────────────────────────────────────

  protected readonly diff = $command({
    name: "diff",
    description: "Compare local packages against remote",
    handler: async ({ root, run }) => {
      const opts = this.resolveOptions();

      let result: VendorDiffResult = { packages: [], totalChanges: 0 };

      await run({
        name: `Cloning ${opts.remote} at ${opts.branch}`,
        handler: async () => {
          result = await this.vendorService.diff({
            root,
            remote: opts.remote,
            branch: opts.branch,
            dir: opts.dir,
            packages: opts.packages,
          });
        },
      });

      run.end();

      if (result.totalChanges === 0) {
        process.stdout.write("\nNo changes\n\n");
        return;
      }

      for (const pkg of result.packages) {
        this.printPackageDiff(pkg);
      }

      process.stdout.write("\n");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  protected printPackageDiff(pkg: VendorPackageDiff) {
    const c = this.color;
    const count = pkg.added.length + pkg.modified.length + pkg.removed.length;

    if (count === 0) {
      process.stdout.write(`\n${c.set("CYAN", pkg.name)}: no changes\n`);
      return;
    }

    process.stdout.write(
      `\n${c.set("CYAN", pkg.name)}: ${count} ${count === 1 ? "file differs" : "files differ"}\n`,
    );

    for (const file of pkg.added) {
      process.stdout.write(`  ${c.set("GREEN", "A")} ${file}\n`);
    }

    for (const fileDiff of pkg.modified) {
      process.stdout.write(`  ${c.set("ORANGE", "M")} ${fileDiff.file}\n`);
      for (const change of fileDiff.changes) {
        const prefix = change.type === "removed" ? "-" : "+";
        const color = change.type === "removed" ? "RED" : "GREEN";
        const lineNum = `L${change.line}`;
        process.stdout.write(
          `      ${c.set("DIM", lineNum.padEnd(5))} ${c.set(color, `${prefix} ${change.text}`)}\n`,
        );
      }
    }

    for (const file of pkg.removed) {
      process.stdout.write(`  ${c.set("RED", "D")} ${file}\n`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Parent command
  // ─────────────────────────────────────────────────────────────────────────

  public readonly vendor = $command({
    name: "vendor",
    description: "Vendor Alepha packages into the project",
    children: [this.sync, this.diff],
    handler: async ({ help }) => {
      help();
    },
  });
}

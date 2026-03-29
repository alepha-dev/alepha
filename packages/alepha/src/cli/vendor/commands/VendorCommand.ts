import { $inject, $use, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { vendorOptions } from "../atoms/vendorOptions.ts";
import type {
  VendorDiffResult,
  VendorSyncResult,
} from "../services/VendorService.ts";
import { VendorService } from "../services/VendorService.ts";

/**
 * Default remote when none is configured.
 */
const DEFAULT_REMOTE = "git@github.com:feunard/alepha.git";

export class VendorCommand {
  protected readonly log = $logger();
  protected readonly options = $use(vendorOptions);
  protected readonly vendorService = $inject(VendorService);
  protected readonly color = $inject(ConsoleColorProvider);

  /**
   * Ensure vendor config is present and return resolved options.
   */
  protected resolveOptions() {
    if (!this.options) {
      throw new AlephaError(
        'Missing vendor configuration. Add a "vendor" section to alepha.config.ts.',
      );
    }
    return {
      remote: this.options.remote ?? DEFAULT_REMOTE,
      branch: this.options.branch ?? "main",
      packages: this.options.packages,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // alepha vendor sync
  // ─────────────────────────────────────────────────────────────────────────

  protected readonly syncFlags = t.object({
    force: t.optional(
      t.boolean({
        aliases: ["f"],
        description: "Skip local modification check",
      }),
    ),
  });

  protected readonly sync = $command({
    name: "sync",
    description: "Replace local packages with remote source",
    flags: this.syncFlags,
    handler: async ({ flags, root, run }) => {
      const opts = this.resolveOptions();
      const c = this.color;

      let result: VendorSyncResult = { synced: [], errors: [] };

      await run({
        name: `Syncing from ${opts.branch}`,
        handler: async () => {
          result = await this.vendorService.sync({
            root,
            remote: opts.remote,
            branch: opts.branch,
            packages: opts.packages,
            force: flags.force,
          });
        },
      });

      run.end();

      if (result.aborted) {
        process.stdout.write(
          `\nLocal modifications detected. Use ${c.set("CYAN", "--force")} to overwrite.\n`,
        );

        for (const pkg of result.aborted.packages) {
          const count =
            pkg.added.length + pkg.modified.length + pkg.removed.length;
          if (count === 0) continue;

          process.stdout.write(
            `\n${c.set("CYAN", pkg.name)}: ${count} file(s) differ\n`,
          );
          for (const file of pkg.added) {
            process.stdout.write(`  ${c.set("GREEN", "A")} ${file}\n`);
          }
          for (const file of pkg.modified) {
            process.stdout.write(`  ${c.set("ORANGE", "M")} ${file}\n`);
          }
          for (const file of pkg.removed) {
            process.stdout.write(`  ${c.set("RED", "D")} ${file}\n`);
          }
        }

        process.stdout.write("\n");
        return;
      }

      if (result.errors.length > 0) {
        for (const error of result.errors) {
          process.stdout.write(`${c.set("RED", "  error")} ${error}\n`);
        }
      }

      if (result.synced.length > 0) {
        process.stdout.write(
          `\nSynced ${c.set("CYAN", String(result.synced.length))} package(s) from ${c.set("CYAN", opts.branch)}\n`,
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
            packages: opts.packages,
          });
        },
      });

      run.end();

      if (result.totalChanges === 0) {
        process.stdout.write("\nNo changes\n\n");
        return;
      }

      const c = this.color;

      for (const pkg of result.packages) {
        const count =
          pkg.added.length + pkg.modified.length + pkg.removed.length;
        if (count === 0) {
          process.stdout.write(`\n${c.set("CYAN", pkg.name)}: no changes\n`);
          continue;
        }

        process.stdout.write(
          `\n${c.set("CYAN", pkg.name)}: ${count} file(s) differ\n`,
        );

        for (const file of pkg.added) {
          process.stdout.write(`  ${c.set("GREEN", "A")} ${file}\n`);
        }
        for (const file of pkg.modified) {
          process.stdout.write(`  ${c.set("ORANGE", "M")} ${file}\n`);
        }
        for (const file of pkg.removed) {
          process.stdout.write(`  ${c.set("RED", "D")} ${file}\n`);
        }
      }

      process.stdout.write("\n");
    },
  });

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

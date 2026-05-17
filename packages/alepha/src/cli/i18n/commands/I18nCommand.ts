import { $inject, $state } from "alepha";
import { $command } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { i18nOptions } from "../atoms/i18nOptions.ts";
import { I18nCheckService } from "../services/I18nCheckService.ts";

export class I18nCommand {
  protected readonly log = $logger();
  protected readonly options = $state(i18nOptions);
  protected readonly checkService = $inject(I18nCheckService);
  protected readonly color = $inject(ConsoleColorProvider);

  protected resolveOptions() {
    return {
      scan: this.options?.scan ?? ["src"],
      dynamicPrefixes: this.options?.dynamicPrefixes ?? [],
      exclude: this.options?.exclude ?? [],
    };
  }

  protected readonly check = $command({
    name: "check",
    description: "Report translation keys with no quoted-literal reference",
    handler: async ({ root }) => {
      const opts = this.resolveOptions();
      const c = this.color;

      const result = await this.checkService.check({ root, ...opts });

      if (result.totalKeys === 0) {
        process.stdout.write(
          `\n${c.set("ORANGE", "warn")} No translation keys found. ` +
            `Did the dictionary location change? ` +
            `Searched: ${opts.scan.join(", ")}\n\n`,
        );
        process.exit(2);
      }

      process.stdout.write(
        `\nChecked ${c.set("CYAN", String(result.totalKeys))} keys across ` +
          `${c.set("CYAN", String(result.scannedFiles))} files ` +
          `(${result.dictionaryFiles.length} dictionary ` +
          `${result.dictionaryFiles.length === 1 ? "file" : "files"}).\n`,
      );
      if (result.exemptKeys > 0) {
        process.stdout.write(
          `  exempt (dynamic prefixes): ${result.exemptKeys}\n`,
        );
      }

      if (result.unused.length === 0) {
        process.stdout.write(
          `\n${c.set("GREEN", "✓")} All translations are referenced.\n\n`,
        );
        return;
      }

      process.stdout.write(
        `\n${c.set("RED", "✗")} Unused translations (${result.unused.length}):\n`,
      );
      for (const k of result.unused) {
        process.stdout.write(`  ${c.set("DIM", "-")} ${k}\n`);
      }
      process.stdout.write(
        `\nEither delete the key from its dictionary, or add its prefix to ` +
          `${c.set("CYAN", "dynamicPrefixes")} in alepha.config.ts ` +
          `if it's constructed at runtime.\n\n`,
      );
      process.exit(1);
    },
  });

  public readonly i18n = $command({
    name: "i18n",
    description: "Internationalization tooling",
    children: [this.check],
    handler: async ({ help }) => {
      help();
    },
  });
}

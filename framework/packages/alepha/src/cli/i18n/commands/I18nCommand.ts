import { $inject, $store } from "alepha";
import { $command } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";

import { i18nOptions } from "../atoms/i18nOptions.ts";
import { I18nCheckService } from "../services/I18nCheckService.ts";

export class I18nCommand {
  protected readonly log = $logger();
  protected readonly options = $store(i18nOptions);
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
        // An exit code, not `process.exit()`: the latter skips the CLI's own
        // shutdown (hooks, flushed logs) on its way out.
        process.exitCode = 2;
        return;
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

      if (result.badPlaceholders.length > 0) {
        process.stdout.write(
          `\n${c.set("RED", "✗")} Placeholders that never interpolate ` +
            `(${result.badPlaceholders.length}):\n`,
        );
        for (const b of result.badPlaceholders) {
          const file = b.file.startsWith(root)
            ? b.file.slice(root.length + 1)
            : b.file;
          process.stdout.write(
            `  ${c.set("DIM", "-")} ${b.key} ${c.set("DIM", `(${file})`)}: ` +
              `${b.placeholder}\n`,
          );
        }
        process.stdout.write(
          `\nAlepha interpolates ${c.set("CYAN", "$1")}, ` +
            `${c.set("CYAN", "$2")}, … and ${c.set("CYAN", "{name}")}, and a ` +
            `name is never a number: a ${c.set("CYAN", "{0}")} is copied ` +
            `into the rendered string verbatim. Rewrite the placeholder as ` +
            `${c.set("CYAN", "$1")} (the FIRST argument, not ` +
            `${c.set("CYAN", "$0")}) or as a named ` +
            `${c.set("CYAN", "{name}")}.\n`,
        );
      }

      if (result.missingArgs.length > 0) {
        process.stdout.write(
          `\n${c.set("RED", "✗")} Calls passing too few arguments ` +
            `(${result.missingArgs.length}):\n`,
        );
        for (const a of result.missingArgs) {
          const file = a.file.startsWith(root)
            ? a.file.slice(root.length + 1)
            : a.file;
          process.stdout.write(
            `  ${c.set("DIM", "-")} ${a.key} ${c.set("DIM", `(${file})`)}: ` +
              `needs ${a.needs}, passes ${a.got}\n`,
          );
        }
        process.stdout.write(
          `\nThe unfilled ${c.set("CYAN", "$N")} is rendered to the user ` +
            `verbatim. Pass ${c.set("CYAN", "{ args: [...] }")} at the call ` +
            `site, or drop the placeholder from the entry.\n`,
        );
      }

      if (result.missingNames.length > 0) {
        process.stdout.write(
          `\n${c.set("RED", "✗")} Calls leaving a named placeholder unfilled ` +
            `(${result.missingNames.length}):\n`,
        );
        for (const a of result.missingNames) {
          const file = a.file.startsWith(root)
            ? a.file.slice(root.length + 1)
            : a.file;
          process.stdout.write(
            `  ${c.set("DIM", "-")} ${a.key} ${c.set("DIM", `(${file})`)}: ` +
              `missing ${a.names.map((n) => `{${n}}`).join(", ")}\n`,
          );
        }
        process.stdout.write(
          `\nThe unfilled ${c.set("CYAN", "{name}")} is rendered to the user ` +
            `verbatim. Pass ${c.set("CYAN", "{ args: { name } }")} at the ` +
            `call site (${c.set("CYAN", "{count}")} takes the ` +
            `${c.set("CYAN", "count")} option), or drop the placeholder.\n`,
        );
      }

      const pluralErrors = result.pluralIssues.filter(
        (i) => i.severity === "error",
      );
      if (result.pluralIssues.length > 0) {
        process.stdout.write(
          `\n${c.set(pluralErrors.length > 0 ? "RED" : "ORANGE", pluralErrors.length > 0 ? "✗" : "warn")} ` +
            `Plural entries that do not fit their language ` +
            `(${result.pluralIssues.length}):\n`,
        );
        for (const i of result.pluralIssues) {
          const file = i.file.startsWith(root)
            ? i.file.slice(root.length + 1)
            : i.file;
          const what =
            i.kind === "missing"
              ? `missing ${i.categories.join(", ")}`
              : i.kind === "unexpected"
                ? `${i.categories.join(", ")} never selected (warning)`
                : `a plain string in ${i.categories.join(", ")}`;
          process.stdout.write(
            `  ${c.set("DIM", "-")} ${i.key} [${i.lang}] ` +
              `${c.set("DIM", `(${file})`)}: ${what}\n`,
          );
        }
        process.stdout.write(
          `\nA plural entry needs ${c.set("CYAN", "other")} and every ` +
            `category its language selects for a whole number. A language ` +
            `with no distinction writes ${c.set("CYAN", '{ other: "..." }')} ` +
            `alone, so the call passes a count in every language.\n`,
        );
      }

      if (result.unused.length > 0) {
        process.stdout.write(
          `\n${c.set("RED", "✗")} Unused translations (${result.unused.length}):\n`,
        );
        for (const k of result.unused) {
          process.stdout.write(`  ${c.set("DIM", "-")} ${k}\n`);
        }
        process.stdout.write(
          `\nEither delete the key from its dictionary, or add its prefix to ` +
            `${c.set("CYAN", "dynamicPrefixes")} in alepha.config.ts ` +
            `if it's constructed at runtime.\n`,
        );
      }

      if (
        result.unused.length === 0 &&
        result.badPlaceholders.length === 0 &&
        result.missingArgs.length === 0 &&
        result.missingNames.length === 0 &&
        pluralErrors.length === 0
      ) {
        process.stdout.write(
          `\n${c.set("GREEN", "✓")} All translations are referenced.\n\n`,
        );
        return;
      }

      process.stdout.write("\n");
      process.exitCode = 1;
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

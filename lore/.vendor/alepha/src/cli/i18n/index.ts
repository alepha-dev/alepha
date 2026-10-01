import { $context, $module } from "alepha";

import { type I18nOptions, i18nOptions } from "./atoms/i18nOptions.ts";
import { I18nCommand } from "./commands/I18nCommand.ts";
import { I18nCheckService } from "./services/I18nCheckService.ts";

// ---------------------------------------------------------------------------

/**
 * CLI plugin for finding unused translation keys.
 *
 * Statically scans the project for `$dictionary(...)` calls, extracts
 * every declared key, and reports the ones that have no quoted-literal
 * reference anywhere else in the source tree. Designed to be wired
 * into `yarn v` (or any verify pipeline) so dead i18n entries can't
 * pile up unnoticed when a feature is removed.
 *
 * Commands:
 * - `alepha i18n check`: report unused translation keys
 *
 * Configuration in `alepha.config.ts`:
 *
 * ```typescript
 * import { i18n } from "alepha/cli/i18n";
 *
 * export default defineConfig({
 *   plugins: [
 *     i18n({
 *       scan: ["src", ".vendor/@alepha/ui"],
 *       dynamicPrefixes: ["folio.type.", "feedback.filter."],
 *     }),
 *   ],
 * });
 * ```
 *
 * @module alepha.cli.i18n
 */
export const AlephaCliI18nPlugin = $module({
  name: "alepha.cli.plugins.i18n",
  atoms: [i18nOptions],
  services: [I18nCommand, I18nCheckService],
});

export const i18n = (options: I18nOptions = {}) => {
  return () => {
    const { alepha } = $context();
    alepha.with(AlephaCliI18nPlugin).set(i18nOptions, options);
  };
};

// ---------------------------------------------------------------------------

export * from "./atoms/i18nOptions.ts";
export * from "./commands/I18nCommand.ts";
export * from "./services/I18nCheckService.ts";

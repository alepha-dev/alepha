import { $atom, type Static, t } from "alepha";

/**
 * i18n CLI configuration atom.
 *
 * Filled from the `i18n` plugin in `alepha.config.ts`.
 * Read by `I18nCommand` to drive `alepha i18n check`.
 */
export const i18nOptions = $atom({
  name: "alepha.cli.i18n.options",
  description: "i18n unused-key check configuration",
  schema: t.optional(
    t.object({
      /**
       * Directories (relative to the project root) to scan both for
       * `$dictionary(...)` declarations and for translation key usage.
       *
       * @default ["src"]
       */
      scan: t.optional(t.array(t.text())),

      /**
       * Key prefixes that are constructed at runtime (e.g. via template
       * literals like `` tr(`archive.type.${kind}`) ``). Every key
       * starting with one of these prefixes is exempted from the
       * unused check.
       *
       * Keep this list short and audit it when a feature is removed —
       * a stale prefix here means dead keys can hide.
       *
       * @default []
       */
      dynamicPrefixes: t.optional(t.array(t.text())),

      /**
       * Additional path substrings (matched against the full file
       * path) that should be excluded from the scan, on top of the
       * defaults (`node_modules`, `dist`, `__tests__`, `.spec.*`,
       * `.test.*`, `.alepha`).
       *
       * @default []
       */
      exclude: t.optional(t.array(t.text())),
    }),
  ),
});

/**
 * Type for i18n options.
 */
export type I18nOptions = Static<typeof i18nOptions.schema>;

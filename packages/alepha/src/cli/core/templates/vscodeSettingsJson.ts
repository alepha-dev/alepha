/**
 * `.vscode/settings.json` — makes the editor agree with the CLI on two things
 * it would otherwise get wrong.
 *
 * **TypeScript.** Points the language server at the `typescript` copy embedded
 * in `alepha`'s dependencies, so the IDE type-checks with the exact compiler
 * `alepha typecheck` runs. Without it VS Code falls back to its own bundled
 * TypeScript, which drifts from whatever `alepha` ships — the classic "green in
 * CI, red squiggles in the editor" skew.
 *
 * The path assumes a hoisting package manager (yarn node-modules / npm / bun),
 * where `alepha`'s `typescript` dependency lands at the project's top-level
 * `node_modules/typescript`. Since the project no longer declares its own
 * `typescript`, that is the only copy present.
 *
 * **Biome.** The project ships a `biome.json` and `alepha lint` formats with
 * Biome, but the editor had no idea: format-on-save reached for whatever
 * default was configured and then `alepha lint` reformatted it back. Two tools
 * disagreeing on the same file is worse than either one alone, so the formatter
 * is pinned per-language — a bare `editor.defaultFormatter` would also claim
 * file types Biome does not handle.
 *
 * `source.fixAll.biome` is the one action to register — in Biome v2 it covers
 * import sorting too, and `biome check --fix` actively rewrites the older
 * `quickfix.biome` / `source.organizeImports.biome` pair into it. Writing the
 * deprecated names here made `alepha init` produce a file that its own closing
 * lint pass immediately edited: a fresh project should be lint-clean, not
 * arrive with a diff already pending.
 *
 * `"explicit"` means it runs on an explicit save and not on autosave. Import
 * sorting that fires mid-keystroke moves code out from under the cursor.
 *
 * This only takes effect with the Biome extension installed, which is why
 * {@link vscodeExtensionsJson} recommends it: pointing `defaultFormatter` at an
 * absent extension makes VS Code complain on every save.
 */
export const vscodeSettingsJson = () =>
  `
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.biome": "explicit"
  },
  "[javascript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[javascriptreact]": { "editor.defaultFormatter": "biomejs.biome" },
  "[typescript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[typescriptreact]": { "editor.defaultFormatter": "biomejs.biome" },
  "[json]": { "editor.defaultFormatter": "biomejs.biome" },
  "[jsonc]": { "editor.defaultFormatter": "biomejs.biome" },
  "[css]": { "editor.defaultFormatter": "biomejs.biome" }
}
`.trim() + "\n";

/**
 * `.vscode/extensions.json` — the workspace recommendation prompt.
 *
 * Without it, {@link vscodeSettingsJson}'s formatter setting names an extension
 * the user may not have, and VS Code reports "Extension 'biomejs.biome' is
 * configured as formatter but it is not available" on every save.
 */
export const vscodeExtensionsJson = () =>
  `
{
  "recommendations": ["biomejs.biome"]
}
`.trim() + "\n";

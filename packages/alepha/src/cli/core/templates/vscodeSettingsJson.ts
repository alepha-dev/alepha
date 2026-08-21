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
 * **Oxc.** The project ships an `.oxlintrc.json` and an `.oxfmtrc.json` and
 * `alepha lint` runs oxlint then oxfmt, but the editor had no idea:
 * format-on-save reached for whatever default was configured and then
 * `alepha lint` reformatted it back. Two tools disagreeing on the same file is
 * worse than either one alone, so the formatter is pinned per-language — a bare
 * `editor.defaultFormatter` would also claim file types oxfmt does not handle.
 *
 * Two save actions, because the Oxc extension keeps the halves separate the
 * same way the CLI does: `source.fixAll.oxc` applies oxlint's fixes and
 * `source.format.oxc` runs oxfmt, which is also what sorts imports.
 *
 * `"explicit"` means they run on an explicit save and not on autosave. Import
 * sorting that fires mid-keystroke moves code out from under the cursor.
 *
 * This only takes effect with the Oxc extension installed, which is why
 * {@link vscodeExtensionsJson} recommends it: pointing `defaultFormatter` at an
 * absent extension makes VS Code complain on every save.
 */
export const vscodeSettingsJson = () =>
  `
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.oxc": "explicit",
    "source.format.oxc": "explicit"
  },
  "[javascript]": { "editor.defaultFormatter": "oxc.oxc-vscode" },
  "[javascriptreact]": { "editor.defaultFormatter": "oxc.oxc-vscode" },
  "[typescript]": { "editor.defaultFormatter": "oxc.oxc-vscode" },
  "[typescriptreact]": { "editor.defaultFormatter": "oxc.oxc-vscode" },
  "[json]": { "editor.defaultFormatter": "oxc.oxc-vscode" },
  "[jsonc]": { "editor.defaultFormatter": "oxc.oxc-vscode" },
  "[css]": { "editor.defaultFormatter": "oxc.oxc-vscode" }
}
`.trim() + "\n";

/**
 * `.vscode/extensions.json` — the workspace recommendation prompt.
 *
 * Without it, {@link vscodeSettingsJson}'s formatter setting names an extension
 * the user may not have, and VS Code reports "Extension 'oxc.oxc-vscode' is
 * configured as formatter but it is not available" on every save.
 */
export const vscodeExtensionsJson = () =>
  `
{
  "recommendations": ["oxc.oxc-vscode"]
}
`.trim() + "\n";

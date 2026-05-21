/**
 * `.vscode/settings.json` — points the editor's TypeScript language server
 * at the `typescript` copy embedded in `alepha`'s dependencies, so the IDE
 * type-checks with the exact same compiler version as `alepha typecheck`.
 *
 * Without this, VS Code falls back to its own bundled TypeScript, which
 * drifts from whatever `alepha` ships — the classic "green in CI, red
 * squiggles in the editor" skew.
 *
 * The path assumes a hoisting package manager (yarn node-modules / npm /
 * bun), where `alepha`'s `typescript` dependency lands at the project's
 * top-level `node_modules/typescript`. Since the project no longer declares
 * its own `typescript`, that is the only copy present.
 */
export const vscodeSettingsJson = () =>
  `
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
`.trim();

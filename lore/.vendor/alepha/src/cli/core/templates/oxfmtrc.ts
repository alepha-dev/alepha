/**
 * `.oxfmtrc.json` — the formatter half of the toolchain `alepha lint` runs.
 *
 * Two spaces at 80 columns, double quotes, semicolons, trailing commas: the
 * shape Alepha's own sources are written in, so a scaffolded project reads the
 * same as the framework it imports. These are spelled out rather than left to
 * oxfmt's defaults because the defaults are Prettier's, and one of them (tabs)
 * disagrees with the `.editorconfig` `alepha init` writes next to this file.
 *
 * `sortImports` replaces what Biome's `organizeImports` assist used to do. The
 * default groups (node builtins, then packages, then internal, then relative)
 * are what a hand-sorted file already looks like; the visible change is a blank
 * line between the groups.
 *
 * `dist` and `.gen` are ignored because they are build output — oxfmt already
 * skips anything `.gitignore` lists, so this only matters for a project that
 * commits either one.
 */
export const oxfmtrc = () =>
  `
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 80,
  "singleQuote": false,
  "semi": true,
  "trailingComma": "all",
  "sortImports": true,
  "ignorePatterns": ["dist", ".gen", "public", ".playwright", "playwright-report", "test-results"]
}
`.trim() + "\n";

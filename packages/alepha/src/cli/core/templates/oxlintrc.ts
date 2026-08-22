/**
 * `.oxlintrc.json` — the linter half of the toolchain `alepha lint` runs.
 *
 * Only the `correctness` category, and it is an error: a lint gate nobody can
 * pass is a lint gate nobody keeps. The wider categories are not a matter of
 * taste here — `suspicious` + `perf` across every plugin reports thousands of
 * findings on a real app, `react/react-in-jsx-scope` alone accounting for most
 * of them because it predates the automatic JSX runtime every Alepha project
 * compiles with.
 *
 * The rules turned off below are the ones whose premise does not hold in an
 * Alepha app, each for a reason a future reader can check. Everything else is
 * left alone deliberately: a scaffolded project should fail on a real bug and
 * on nothing else.
 *
 * `ignorePatterns` carries `node_modules` because oxlint has no built-in
 * exclusion for it, unlike oxfmt, and falls back on whatever ignore files it
 * happens to find. `alepha lint` passes the same pattern on the command line,
 * so this entry is what covers the editor: the scaffold recommends the Oxc
 * extension and turns on `source.fixAll.oxc`, and the extension reads this
 * file rather than the CLI. Without it, a project whose `.gitignore` is
 * missing gets its dependencies linted, and fixed.
 */
export const oxlintrc = () =>
  `
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error"
  },
  "ignorePatterns": ["node_modules", "dist", ".gen"],
  "plugins": [
    "typescript",
    "unicorn",
    "oxc",
    "react",
    "import",
    "promise",
    "vitest"
  ],
  "rules": {
    // Alepha's hooks take primitives out of the DI container. Those are stable
    // for the lifetime of the container, and the rule has no way to know it.
    "react-hooks/exhaustive-deps": "off",
    // The latest-ref pattern (\`ref.current = props.onChange\`), refs used to
    // carry a value across renders precisely so re-rendering is NOT triggered,
    // and refs passed down as a \`ref\` prop all read as violations. The rule
    // encodes React Compiler semantics, which Alepha does not opt into.
    "react/refs": "off",
    // Reports where React Compiler would have to skip a component. Alepha does
    // not compile with React Compiler, so the diagnostic describes an
    // optimisation that was never going to happen.
    "react/preserve-manual-memoization": "off",
    // Fires on \`{Icon && <Icon />}\` where \`Icon\` came out of a lookup table.
    // The rule cannot follow the lookup and reads the capitalised local as a
    // component built during render.
    "react/static-components": "off",
    // Vitest's \`expect\` takes an optional message as its second argument,
    // which Jest's does not; the rule defaults to Jest's arity.
    "vitest/valid-expect": ["error", { "maxArgs": 2 }],
    // Alepha's test fixture hands \`expect\` to the test body
    // (\`test("…", ({ expect }) => …)\`) rather than being imported, and the rule
    // counts assertions by identifier — so it reports tests full of assertions
    // as having none.
    "vitest/expect-expect": "off"
  }
}
`.trim() + "\n";

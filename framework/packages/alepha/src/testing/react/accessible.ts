import { AlephaError } from "alepha";

/**
 * Options for {@link expectAccessible}.
 */
export interface ExpectAccessibleOptions {
  /**
   * axe rule ids to switch off for this one call, on top of the rules the
   * helper always switches off under jsdom.
   *
   * There is no global switch: a rule is disabled where its false positive is,
   * with the reason beside the call.
   *
   * @example ["landmark-one-main"]
   */
  disable?: string[];
}

/**
 * The WCAG tags every accessibility helper of `alepha/testing` runs:
 * WCAG 2.0, 2.1 and 2.2, levels A and AA.
 */
export const ACCESSIBILITY_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

/**
 * The axe rules {@link expectAccessible} always switches off, because they
 * need a stylesheet or a layout and jsdom provides neither.
 *
 * - `color-contrast` and `color-contrast-enhanced`: axe's own README lists
 *   them as the rules that do not work under jsdom, where no style is computed
 *   and they return no result. Left on, they read as a pass nobody measured.
 * - `target-size`: needs the rendered box of every target, and jsdom lays out
 *   nothing (every box is 0 by 0).
 *
 * Contrast and target size are measured in a real browser, with
 * `expectPageAccessible` from `alepha/testing/playwright`.
 */
export const JSDOM_DISABLED_RULES = [
  "color-contrast",
  "color-contrast-enhanced",
  "target-size",
] as const;

/**
 * Run axe on a jsdom tree and fail with every WCAG 2.2 A and AA violation it
 * finds.
 *
 * Under jsdom axe checks **structure**: accessible names, roles, aria wiring,
 * label association, duplicate ids, nested interactive elements. It cannot
 * check anything that needs a stylesheet or a layout, so the rules listed in
 * {@link JSDOM_DISABLED_RULES} are switched off here. A pass does not mean
 * the page is accessible: axe finds roughly half of real issues by its own
 * figure, and nothing here measures colour.
 *
 * `target` defaults to `document.body`, not to the render container: a
 * dialog, a menu or a popover is usually portalled outside the container, so
 * a scan of the container never sees an open overlay.
 *
 * Needs `axe-core`, an optional peer of `alepha`: `yarn add -D axe-core`. It
 * is loaded when the function is called, so `renderWithAlepha` and the other
 * helpers of this module work without it.
 *
 * @param target - The element to scan. Defaults to `document.body`.
 * @param options - Rules to switch off for this call.
 *
 * @example
 * ```tsx
 * import { expectAccessible, renderWithAlepha } from "alepha/testing/react";
 *
 * it("is accessible with the dialog open", async () => {
 *   await renderWithAlepha(<MyDialog defaultOpen />);
 *   await expectAccessible();
 * });
 * ```
 */
export const expectAccessible = async (
  target?: Element,
  options: ExpectAccessibleOptions = {},
): Promise<void> => {
  let axe: typeof import("axe-core");
  try {
    const mod = await import("axe-core");
    axe = (mod as { default?: typeof import("axe-core") }).default ?? mod;
  } catch {
    throw new AlephaError(
      "expectAccessible needs axe-core, an optional peer of alepha. Install it: yarn add -D axe-core",
    );
  }

  const rules: Record<string, { enabled: boolean }> = {};
  for (const id of [...JSDOM_DISABLED_RULES, ...(options.disable ?? [])]) {
    rules[id] = { enabled: false };
  }

  const results = await axe.run(target ?? document.body, {
    runOnly: { type: "tag", values: [...ACCESSIBILITY_TAGS] },
    rules,
    resultTypes: ["violations"],
  });

  if (results.violations.length === 0) {
    return;
  }

  const lines: string[] = [
    `axe found ${results.violations.length} accessibility violation(s):`,
  ];
  for (const violation of results.violations) {
    lines.push("", `[${violation.id}] ${violation.help}`, violation.helpUrl);
    for (const node of violation.nodes) {
      lines.push(`  ${node.target.join(" ")}`, `    ${node.html}`);
    }
  }
  throw new AlephaError(lines.join("\n"));
};

import type { Page } from "@playwright/test";
import { AlephaError } from "alepha";

/**
 * Options for {@link scanPageAccessibility} and {@link expectPageAccessible}.
 */
export interface PageAccessibilityOptions {
  /**
   * axe rule ids to switch off for this one call. There is no global switch:
   * a rule is disabled where its false positive is, with the reason beside
   * the call.
   */
  disable?: string[];

  /**
   * CSS selectors to scan instead of the whole page.
   */
  include?: string[];

  /**
   * CSS selectors to leave out of the scan.
   */
  exclude?: string[];
}

/**
 * One axe violation on one node: the unit a baseline of known findings is
 * written in.
 */
export interface AccessibilityFinding {
  /**
   * The axe rule id, `color-contrast`.
   */
  rule: string;

  /**
   * One sentence saying what the rule asks.
   */
  help: string;

  /**
   * The rule's documentation page.
   */
  helpUrl: string;

  /**
   * axe's selector for the node. A node inside an iframe is the frame's
   * selector followed by the node's, joined by a space.
   */
  selector: string;

  /**
   * The node's outer HTML, as axe truncated it.
   */
  html: string;
}

/**
 * The WCAG tags the scan runs: WCAG 2.0, 2.1 and 2.2, levels A and AA.
 */
export const PAGE_ACCESSIBILITY_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

/**
 * Run axe on a Playwright page and return its WCAG 2.2 A and AA violations
 * as data, one item per rule and node, without failing.
 *
 * This is the layer that can measure contrast and target size: the page is
 * rendered by a real browser with its stylesheet, so `color-contrast` and
 * `target-size` stay on. Same-origin iframes are scanned too.
 *
 * Use it to compare what axe found with a list of known findings; use
 * {@link expectPageAccessible} to fail on any.
 *
 * Needs `@axe-core/playwright` (which brings `axe-core`), an optional peer of
 * `alepha`: `yarn add -D @axe-core/playwright`.
 *
 * @example
 * ```ts
 * const findings = await scanPageAccessibility(page, { exclude: ["#ad"] });
 * ```
 */
export const scanPageAccessibility = async (
  page: Page,
  options: PageAccessibilityOptions = {},
): Promise<AccessibilityFinding[]> => {
  let AxeBuilder: typeof import("@axe-core/playwright").default;
  try {
    AxeBuilder = (await import("@axe-core/playwright")).default;
  } catch {
    throw new AlephaError(
      "scanPageAccessibility needs @axe-core/playwright, an optional peer of alepha. Install it: yarn add -D @axe-core/playwright",
    );
  }

  // The page type of `@playwright/test` and of `playwright-core` are the same
  // declaration, re-exported; the cast only bridges the two module names.
  let builder = new AxeBuilder({ page: page as never }).withTags([
    ...PAGE_ACCESSIBILITY_TAGS,
  ]);
  if (options.disable?.length) {
    builder = builder.disableRules(options.disable);
  }
  for (const selector of options.include ?? []) {
    builder = builder.include(selector);
  }
  for (const selector of options.exclude ?? []) {
    builder = builder.exclude(selector);
  }

  const results = await builder.analyze();
  const findings: AccessibilityFinding[] = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      findings.push({
        rule: violation.id,
        help: violation.help,
        helpUrl: violation.helpUrl,
        selector: node.target.map((part) => String(part)).join(" "),
        html: node.html,
      });
    }
  }
  return findings;
};

/**
 * Format findings the way every accessibility assertion of
 * `alepha/testing` reports them: per finding, the rule id and what it asks,
 * its help URL, and the node's selector and HTML.
 */
export const formatAccessibilityFindings = (
  findings: AccessibilityFinding[],
): string => {
  const lines: string[] = [
    `axe found ${findings.length} accessibility violation(s):`,
  ];
  for (const finding of findings) {
    lines.push(
      "",
      `[${finding.rule}] ${finding.help}`,
      finding.helpUrl,
      `  ${finding.selector}`,
      `    ${finding.html}`,
    );
  }
  return lines.join("\n");
};

/**
 * Run axe on a Playwright page and fail with every WCAG 2.2 A and AA
 * violation it finds, contrast and target size included.
 *
 * {@link scanPageAccessibility} plus the assertion. A pass does not mean the
 * page is accessible: axe finds roughly half of real issues by its own
 * figure, and it has no rule for non-text contrast (WCAG 1.4.11).
 *
 * @example
 * ```ts
 * import { test } from "@playwright/test";
 * import { expectPageAccessible } from "alepha/testing/playwright";
 *
 * test("the home page is accessible", async ({ page }) => {
 *   await page.goto("/");
 *   await expectPageAccessible(page);
 * });
 * ```
 */
export const expectPageAccessible = async (
  page: Page,
  options: PageAccessibilityOptions = {},
): Promise<void> => {
  const findings = await scanPageAccessibility(page, options);
  if (findings.length > 0) {
    throw new AlephaError(formatAccessibilityFindings(findings));
  }
};

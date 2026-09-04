import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The folio tree's two icon colours must exist in EVERY theme, light and
 * dark (feedback #2089).
 *
 * This reads the stylesheet rather than a rendered page because the failure
 * it guards is a theme that simply does not declare the pair: the value then
 * falls back to whichever block declared it last, so the tree quietly wears
 * another theme's colours and nothing errors. Six themes times two modes is
 * also more than anyone re-checks by hand when a seventh is added.
 *
 * ⚠️ It cannot tell you the colours look GOOD, only that each theme states
 * its own and that the two are distinguishable. The report's complaint was
 * that folder and folio were "two greys", so distinctness is the property
 * with teeth.
 */
describe("folio tree theme tokens", () => {
  const css = readFileSync(
    join(import.meta.dirname, "../src/main.css"),
    "utf8",
  );

  /**
   * Every selector block that establishes a palette: the two defaults, plus
   * light and dark for each of the five named themes.
   */
  const BLOCKS = [
    ":root",
    ".dark",
    ".theme-twilight",
    ".dark.theme-twilight",
    ".theme-sylvan",
    ".dark.theme-sylvan",
    ".theme-arcane",
    ".dark.theme-arcane",
    ".theme-frost",
    ".dark.theme-frost",
    ".theme-claude",
    ".dark.theme-claude",
  ];

  /**
   * The declarations of one block, found by its selector. Blocks here are
   * flat (no nesting), so a body runs to the first `}` at column zero.
   *
   * ⚠️ A selector can open more than one block: `:root` does, since the
   * shadow tokens have their own. So this returns the one that declares the
   * pair, and falls back to the first match so a theme that declares it
   * nowhere still fails on the assertion rather than on a lookup.
   */
  const bodyOf = (selector: string): string => {
    const bodies: string[] = [];
    for (const opener of [`${selector} {`, `${selector},`]) {
      let at = css.indexOf(opener);
      while (at >= 0) {
        const open = css.indexOf("{", at);
        const close = css.indexOf("\n}", open);
        bodies.push(css.slice(open, close));
        at = css.indexOf(opener, at + opener.length);
      }
    }
    expect(bodies.length, `no block for ${selector}`).toBeGreaterThan(0);
    return (
      bodies.find((body) => body.includes("--folio-tree-directory")) ??
      bodies[0]!
    );
  };

  const valueOf = (body: string, token: string): string | undefined =>
    body.match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1]?.trim();

  it.each(BLOCKS)("%s declares both folio tree colours", (selector) => {
    const body = bodyOf(selector);
    expect(valueOf(body, "folio-tree-directory")).toBeDefined();
    expect(valueOf(body, "folio-tree-folio")).toBeDefined();
  });

  it.each(BLOCKS)("%s keeps the two distinguishable", (selector) => {
    const body = bodyOf(selector);
    // The report was "everything is monochrome": the directory and the
    // folio landing on the same value is the exact regression.
    expect(valueOf(body, "folio-tree-directory")).not.toBe(
      valueOf(body, "folio-tree-folio"),
    );
  });

  it("declares the defaults before the themes, or they would win the tie", () => {
    // `:root` and `.theme-sylvan` both score (0,1,0) against <html>, so the
    // later rule wins. Defaults placed after the themes would override all
    // six of them, silently.
    const defaultsAt = css.indexOf("--folio-tree-directory");
    const firstThemeAt = css.indexOf(".theme-twilight");
    expect(defaultsAt).toBeGreaterThanOrEqual(0);
    expect(defaultsAt).toBeLessThan(firstThemeAt);
  });

  it("ports no literal hex from the apps/docs explorer", () => {
    // The reference file tree spells its palette as hexes for one dark
    // theme. `oklch(...)` everywhere is what keeps this pair theme-aware.
    for (const selector of BLOCKS) {
      const body = bodyOf(selector);
      for (const token of ["folio-tree-directory", "folio-tree-folio"]) {
        expect(valueOf(body, token)).toMatch(/^oklch\(/);
      }
    }
  });
});

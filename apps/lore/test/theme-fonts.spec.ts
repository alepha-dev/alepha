import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The theme typography contract.
 *
 * ⚠️ Written after finding that the whole of it was DEAD. Four tokens -
 * `--font-display`, `--display-tracking`, `--display-weight` and
 * `--display-transform` - were declared by four themes and read by nothing:
 * no `var()` in any stylesheet, and no Tailwind utility either, because they
 * sat in a plain `:root` instead of `@theme`. Three display faces were
 * fetched, self-hosted and link-swapped on every theme change without ever
 * being drawn, and three of the five themes were typographically identical
 * as a result. A comment claimed they were "used on h1/h2/h3 + .display
 * utility"; neither the rule nor the utility existed.
 *
 * Nothing went red for it, and nothing could have: a declared-but-unread
 * custom property is valid CSS, the fonts really were downloaded, and the
 * e2e that checks the face "loaded" reads `document.fonts`, which lists
 * REGISTERED faces rather than rendered ones - so it passed throughout.
 *
 * The three tests below are the three halves that were missing (declared,
 * consumed, downloadable). Only the second one would have caught the
 * original bug, so it is the one not to weaken.
 */
describe("theme fonts", () => {
  const LORE_ROOT = join(import.meta.dirname, "..");
  const mainCss = readFileSync(join(LORE_ROOT, "src/main.css"), "utf8");
  const uiCss = readFileSync(
    join(LORE_ROOT, "../../packages/@alepha/ui/src/styles.css"),
    "utf8",
  );

  /** The themes `ThemesProvider` publishes, minus `default` where noted. */
  const NAMED_THEMES = ["forest", "lavandula", "winter", "tangor"];
  const ALL_THEMES = ["default", ...NAMED_THEMES];

  /**
   * Faces `@alepha/ui` imports from `@fontsource` on every page, so a theme
   * may name one without its own stylesheet carrying it.
   */
  const ALWAYS_LOADED = new Set(["Inter Variable", "JetBrains Mono Variable"]);

  /**
   * Tokens whose consumer is Tailwind rather than a rule in this repo, with
   * the consumer named. Preflight sets `html` from `--font-sans` and
   * `code`/`pre`/`kbd`/`samp` from `--font-mono`, and both utilities
   * (`font-sans`, `font-mono`) reference the variable rather than inlining
   * it, which is what makes a theme class able to move them at runtime.
   *
   * ⚠️ An entry here is a claim that something OUTSIDE these stylesheets
   * reads the token. Adding a token to this list to make the test pass is
   * how the dead one would have survived - verify in a browser first.
   */
  const CONSUMED_BY_TAILWIND = new Set(["--font-sans", "--font-mono"]);

  /** The declaration block of a selector, or undefined when absent. */
  const blockOf = (css: string, selector: string): string | undefined => {
    const opener = `${selector} {`;
    const at = css.indexOf(opener);
    if (at < 0) return undefined;
    const open = css.indexOf("{", at);
    return css.slice(open, css.indexOf("\n}", open));
  };

  const declarationIn = (block: string, token: string): string | undefined =>
    block.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.replace(/\s+/g, " ");

  /**
   * What a theme resolves a face to, following the one inheritance step the
   * cascade gives it: a theme that does not name a face keeps `:root`'s, and
   * `--font-heading` defaults to the text face (declared in `@alepha/ui`).
   */
  const faceFor = (theme: string, token: string): string => {
    const root = blockOf(mainCss, ":root")!;
    const themeBlock =
      theme === "default" ? undefined : blockOf(mainCss, `.theme-${theme}`);
    const value =
      (themeBlock ? declarationIn(themeBlock, token) : undefined) ??
      declarationIn(root, token) ??
      (token === "--font-heading" ? faceFor(theme, "--font-sans") : undefined);
    expect(value, `${theme} resolves ${token}`).toBeDefined();
    return value!;
  };

  /** The quoted family names of a font stack, in order. */
  const familiesIn = (stack: string): string[] =>
    [...stack.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

  it.each(ALL_THEMES)("%s resolves a text, heading and mono face", (theme) => {
    for (const token of ["--font-sans", "--font-heading", "--font-mono"]) {
      expect(familiesIn(faceFor(theme, token)).length).toBeGreaterThan(0);
    }
  });

  it.each(NAMED_THEMES)("%s is typographically distinct", (theme) => {
    // The point of a theme having faces at all. Before this was wired, three
    // of the four were identical to `default` in every one of the three.
    const mine = ["--font-sans", "--font-heading", "--font-mono"].map((t) =>
      faceFor(theme, t),
    );
    const base = ["--font-sans", "--font-heading", "--font-mono"].map((t) =>
      faceFor("default", t),
    );
    expect(mine).not.toEqual(base);
  });

  it("reads every typography token some theme declares", () => {
    // THE regression guard. A token declared by a theme and read by nothing
    // renders nothing, silently, forever - see this file's own docblock.
    const declared = new Set(
      [...mainCss.matchAll(/^\s*(--(?:font|heading)-[a-z-]+):/gm)].map(
        (m) => m[1]!,
      ),
    );
    expect(declared.size).toBeGreaterThan(0);

    const consumers = mainCss + uiCss;
    const orphans = [...declared].filter(
      (token) =>
        !CONSUMED_BY_TAILWIND.has(token) &&
        !consumers.includes(`var(${token})`) &&
        !consumers.includes(`var(${token},`),
    );

    expect(
      orphans,
      `declared by a theme and read by no rule: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it.each(ALL_THEMES)("%s can actually load the faces it names", (theme) => {
    // `ColorScheme` swaps a SINGLE <link> to the active theme's stylesheet,
    // so a face missing from it is a silent fallback down the stack - which
    // is exactly what the roadmap page shipped for months.
    const sheet = readFileSync(
      join(LORE_ROOT, `public/fonts/${theme}.css`),
      "utf8",
    );

    for (const token of ["--font-sans", "--font-heading", "--font-mono"]) {
      const families = familiesIn(faceFor(theme, token));
      const loadable = families.some(
        (family) =>
          // ⚠️ Quote-agnostic on purpose. `fetch-fonts` writes what Google
          // serves, which is single-quoted, and `yarn lint` then reformats
          // these files to double quotes - so whether this passed depended
          // on whether the formatter had run since the last fetch, which is
          // exactly how it went green here and red under `yarn v`.
          new RegExp(`font-family:\\s*["']${family}["']`).test(sheet) ||
          ALWAYS_LOADED.has(family),
      );
      expect(
        loadable,
        `${theme} names ${families.join(" / ")} for ${token}, and ${theme}.css carries none of them`,
      ).toBe(true);
    }
  });
});

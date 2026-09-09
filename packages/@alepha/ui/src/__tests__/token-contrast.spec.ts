import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * WCAG 2.1 1.4.11 Non-text Contrast, measured on the tokens themselves.
 *
 * The colour is read out of `styles.css` and converted, rather than sampled
 * from a rendered page. A screenshot test answers "does this look like it did
 * last week", which is the wrong question: the border was wrong from the day it
 * was inherited from upstream shadcn, so a snapshot would have pinned the
 * defect rather than caught it. A number either clears 3:1 or it does not.
 *
 * It also means the guard runs without a browser, and fails on the line that
 * caused it: someone re-aliasing `--input` to `--border` gets told which
 * surface it stopped clearing and by how much.
 */
describe("theme token contrast", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"),
    "utf8",
  );

  /**
   * The declarations of one top-level rule, as a plain map.
   *
   * Matched by walking from the selector to its closing brace at depth zero,
   * because these blocks contain nested `color-mix(...)` and comment braces
   * that a lazy `\\{([^}]*)\\}` would stop at.
   */
  const block = (selector: string): Record<string, string> => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `no '${selector}' block in styles.css`).toBeGreaterThan(-1);

    let depth = 0;
    let end = start;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }

    const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
    const tokens: Record<string, string> = {};
    for (const line of body.split(";")) {
      const match = line.match(/(--[\w-]+)\s*:\s*(.+)$/s);
      if (match) tokens[match[1]] = match[2].trim();
    }

    return tokens;
  };

  /**
   * An `oklch(L C H)` or `oklch(L C H / A%)` declaration as sRGB plus alpha.
   *
   * Only oklch is understood, on purpose: every colour in this palette is
   * written that way, and a token that stops being oklch should fail loudly
   * here rather than be silently skipped by a lenient parser.
   */
  const parse = (value: string): { rgb: number[]; alpha: number } => {
    const match = value.match(
      /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)%\s*)?\)$/,
    );
    expect(match, `not an oklch() value: ${value}`).not.toBeNull();

    const [l, c, h] = [1, 2, 3].map((i) => Number(match![i]));
    const alpha = match![4] === undefined ? 1 : Number(match![4]) / 100;

    const hr = (h * Math.PI) / 180;
    const a = c * Math.cos(hr);
    const b = c * Math.sin(hr);
    const lms = [
      (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
      (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
      (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
    ];
    const linear = [
      4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
      -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
      -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
    ];
    const rgb = linear.map((v) => {
      const encoded =
        v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return Math.min(1, Math.max(0, encoded)) * 255;
    });

    return { rgb, alpha };
  };

  /**
   * A translucent line composited over the surface it is drawn on.
   *
   * Load-bearing for the dark theme, where `--input` is white at a low alpha:
   * its ratio is a property of the pair, not of the token, so each surface has
   * to be measured with the token laid over it.
   */
  const flatten = (line: string, surface: string): number[] => {
    const { rgb, alpha } = parse(line);
    const under = parse(surface).rgb;

    return rgb.map((v, i) => v * alpha + under[i] * (1 - alpha));
  };

  const contrast = (a: number[], b: number[]): number => {
    const luminance = (rgb: number[]) => {
      const [r, g, bl] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

    return (hi + 0.05) / (lo + 0.05);
  };

  /**
   * Every surface a bordered control can sit on.
   *
   * `--muted`, `--accent` and `--sidebar-accent` are the ones that bite: they
   * sit closest to the border's own lightness, so a value chosen against
   * `--background` alone passes on the page and fails inside a card header or
   * a hovered row.
   */
  const surfaces = [
    "--background",
    "--card",
    "--popover",
    "--muted",
    "--secondary",
    "--accent",
    "--sidebar",
    "--sidebar-accent",
  ];

  const worst = (
    tokens: Record<string, string>,
    line: string,
  ): { ratio: number; surface: string } =>
    surfaces
      .map((surface) => ({
        surface,
        ratio: contrast(flatten(tokens[line], tokens[surface]), [
          ...parse(tokens[surface]).rgb,
        ]),
      }))
      .reduce((a, b) => (a.ratio <= b.ratio ? a : b));

  /**
   * The whole battery, for one theme's block.
   *
   * A factory called from two literal `describe`s rather than a loop over the
   * pair: `vitest/valid-title` refuses a `describe(variable)`, and it is right
   * to - a computed suite name is one a reporter cannot be grepped for.
   */
  const themeSuite = (selector: string) => {
    const tokens = block(selector);

    it("gives a control's boundary at least 3:1 on every surface", () => {
      const { ratio, surface } = worst(tokens, "--input");

      expect(
        ratio,
        `--input is ${ratio.toFixed(2)}:1 on ${surface}, below 1.4.11's 3:1`,
      ).toBeGreaterThanOrEqual(3);
    });

    it("gives the focus ring at least 3:1 on every surface", () => {
      // A focus indicator is itself "visual information required to identify a
      // user interface component", so the same 3:1 applies to it.
      const { ratio, surface } = worst(tokens, "--ring");

      expect(
        ratio,
        `--ring is ${ratio.toFixed(2)}:1 on ${surface}, below 1.4.11's 3:1`,
      ).toBeGreaterThanOrEqual(3);
    });

    it("keeps the resting border clearly weaker than the focus ring", () => {
      // Both passing 3:1 is not enough: if focus is only marginally stronger
      // than rest, focus reads as a shade rather than as a change. Measured on
      // `--background` so it is one comparison, not a per-surface minimum
      // against a per-surface minimum.
      const on = tokens["--background"];
      const resting = contrast(flatten(tokens["--input"], on), parse(on).rgb);
      const focused = contrast(flatten(tokens["--ring"], on), parse(on).rgb);

      expect(
        focused / resting,
        `focus is only ${(focused / resting).toFixed(2)}x resting ` +
          `(${resting.toFixed(2)}:1 to ${focused.toFixed(2)}:1)`,
      ).toBeGreaterThanOrEqual(1.8);
    });

    it("keeps --border out of it, so dividers stay quiet", () => {
      // The split is the whole fix. `--border` draws card edges and table
      // rules, which 1.4.11 exempts as decoration; if it ever equals `--input`
      // again, one of the two jobs is being done wrong.
      expect(tokens["--border"]).not.toBe(tokens["--input"]);

      const { ratio } = worst(tokens, "--border");
      expect(
        ratio,
        "--border now clears 3:1, which means dividers got heavy: it is " +
          "decoration and should stay quiet. Move the control's boundary " +
          "into --input instead.",
      ).toBeLessThan(3);
    });

    it("gives the sidebar the same focus ring as everywhere else", () => {
      expect(tokens["--sidebar-ring"]).toBe(tokens["--ring"]);
    });
  };

  describe("light", () => {
    themeSuite(":root");
  });

  describe("dark", () => {
    themeSuite(".dark");
  });
});

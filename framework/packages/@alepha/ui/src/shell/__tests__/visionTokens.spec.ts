import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The colour-blind palette is CSS only: `ButtonVision` sets the class `cvd`
 * on `<html>`, and these blocks of the kit's stylesheet are what that class
 * changes. jsdom applies no stylesheet, so the tokens are pinned by reading
 * the file; the showcase's e2e checks the computed values in a real browser.
 */
describe("colour-blind tokens in styles.css", () => {
  const css = readFileSync(
    join(fileURLToPath(new URL(".", import.meta.url)), "../../styles.css"),
    "utf8",
  );

  const block = (selector: string): Record<string, string> => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} block`).toBeGreaterThan(-1);
    const body = css.slice(
      css.indexOf("{", start) + 1,
      css.indexOf("}", start),
    );
    const tokens: Record<string, string> = {};
    for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      tokens[match[1]!] = match[2]!.trim();
    }
    return tokens;
  };

  const SIGNALS = [
    "--success",
    "--success-foreground",
    "--success-text",
    "--warning",
    "--warning-foreground",
    "--warning-text",
    "--danger",
    "--danger-foreground",
    "--danger-text",
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
  ];

  it("remaps every signal token in light and in dark", () => {
    expect(Object.keys(block(":root.cvd")).sort()).toEqual([...SIGNALS].sort());
    expect(Object.keys(block(":root.cvd.dark")).sort()).toEqual(
      [...SIGNALS].sort(),
    );
  });

  it("turns the red/green pair into vermillion/blue", () => {
    const light = block(":root.cvd");
    expect(light["--success"]).toBe("#0072b2");
    expect(light["--danger"]).toBe("#d55e00");
    expect(block(":root.cvd.dark")["--success-text"]).toBe("#4ea8e0");
  });

  it("leaves the brand and the surfaces alone", () => {
    for (const selector of [":root.cvd", ":root.cvd.dark"]) {
      const tokens = block(selector);
      expect(tokens["--primary"]).toBeUndefined();
      expect(tokens["--background"]).toBeUndefined();
      expect(tokens["--foreground"]).toBeUndefined();
    }
  });

  /**
   * WCAG 2 relative luminance contrast, so a retuned value that drops text
   * under AA fails here rather than in a reader's eyes.
   */
  const contrast = (a: string, b: string) => {
    const lum = (hex: string) => {
      const [r, g, bl] = [1, 3, 5]
        .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it("keeps every foreground at AA against what it is drawn on", () => {
    const pages = { ":root.cvd": "#ffffff", ":root.cvd.dark": "#171717" };
    for (const [selector, page] of Object.entries(pages)) {
      const tokens = block(selector);
      for (const intent of ["success", "warning", "danger"]) {
        expect(
          contrast(tokens[`--${intent}`]!, tokens[`--${intent}-foreground`]!),
          `${selector} ${intent} fill`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(tokens[`--${intent}-text`]!, page),
          `${selector} ${intent} text`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /**
   * An achromatic `oklch(L 0 0)` as sRGB hex: OKLab's grey is linear
   * `L` cubed, gamma-encoded.
   */
  const grey = (value: string) => {
    const lightness = Number(/oklch\(([\d.]+) 0 0\)/.exec(value)?.[1]);
    const linear = lightness ** 3;
    const encoded =
      linear <= 0.0031308
        ? linear * 12.92
        : 1.055 * linear ** (1 / 2.4) - 0.055;
    const byte = Math.round(encoded * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${byte}${byte}${byte}`;
  };

  it("keeps muted text at AA on the muted surface, light and dark (#Q3487)", () => {
    // `:root` and `.dark` hold the surfaces; the cvd blocks leave them
    // alone (see above), so these two pairs cover all four token sets.
    // Not `block`: these blocks carry comments with braces in them, so a
    // token is read as its first declaration after the selector.
    const token = (selector: string, name: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, `${selector} block`).toBeGreaterThan(-1);
      return new RegExp(`\\n\\s*${name}:\\s*([^;]+);`)
        .exec(css.slice(start))?.[1]
        ?.trim();
    };
    for (const selector of [":root", ".dark"]) {
      expect(
        contrast(
          grey(token(selector, "--muted-foreground")!),
          grey(token(selector, "--muted")!),
        ),
        `${selector} muted text on muted`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

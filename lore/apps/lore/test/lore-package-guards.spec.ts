import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it } from "vitest";

/**
 * The guards that read `apps/lore` by path, kept in step with the `@lore`
 * packages (#E75, #Q2622).
 *
 * Each of these fails silently when a package is missing from it: no test
 * goes red, the guard simply stops looking at code that moved. So the lists
 * are asserted against the packages on disk.
 */
const REPO = join(import.meta.dirname, "..", "..", "..");
const LORE = join(REPO, "apps", "lore");
const PACKAGES = readdirSync(join(REPO, "packages", "@lore")).filter((pkg) =>
  existsSync(join(REPO, "packages", "@lore", pkg, "package.json")),
);

const exportsOf = (pkg: string): string[] =>
  Object.keys(
    JSON.parse(
      readFileSync(
        join(REPO, "packages", "@lore", pkg, "package.json"),
        "utf8",
      ),
    ).exports ?? {},
  );

describe("@lore package guards", () => {
  it("finds the four packages", ({ expect }) => {
    expect(PACKAGES.sort()).toEqual(["core", "deploy", "knowledge", "work"]);
  });

  /**
   * Tailwind detects classes from the Vite root, `apps/lore`, and never walks
   * into `packages/`. A package missing here loses every class only its
   * components use, which no spec and no e2e would notice.
   */
  it("lists every package exporting ./web as a Tailwind @source", ({
    expect,
  }) => {
    const css = readFileSync(join(LORE, "src", "main.css"), "utf8");
    for (const pkg of PACKAGES.filter((it) =>
      exportsOf(it).includes("./web"),
    )) {
      expect(css, `@lore/${pkg} is not a @source of main.css`).toContain(
        `@source "../../../packages/@lore/${pkg}/src/web";`,
      );
    }
  });

  /**
   * `check:i18n` runs from `apps/lore` only. A package missing from its scan
   * has its `tr()` calls unseen, and their keys reported as unused.
   */
  it("scans every package for check:i18n", ({ expect }) => {
    const config = readFileSync(join(LORE, "alepha.config.ts"), "utf8");
    for (const pkg of PACKAGES) {
      expect(config, `@lore/${pkg} is not in the i18n scan`).toContain(
        `"../../packages/@lore/${pkg}/src"`,
      );
    }
  });
});

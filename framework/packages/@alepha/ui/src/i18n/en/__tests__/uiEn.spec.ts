import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { uiFr } from "../../fr/uiFr.ts";
import { uiEn } from "../uiEn.ts";

/**
 * The English catalogue must say what the components already say.
 *
 * An application spreads `uiEn` into its `en` catalogue, where it wins over the
 * `default` a component passes to `tr()`. So the two must agree: a component
 * whose default is reworded while `uiEn` keeps the old text would show the old
 * text to every application that spreads it, and nothing else would notice.
 *
 * Coverage is checked against `uiFr`, whose own spec checks it against every
 * key the package asks for: the same key set here means the same coverage.
 */
const SRC = join(import.meta.dirname, "..", "..", "..", "..", "src");

/**
 * Every literal default, by key: `tr("key", { default: "…" })` on one call,
 * the form most call sites take. A key may carry two (an `aria-label` and a
 * heading reading the same key), so each key maps to the set it was given.
 * Defaults built from a template literal or a variant object are not read
 * here; the placeholder check below still covers them.
 */
const DEFAULT_PATTERN =
  /\btr\(\s*"([a-zA-Z][\w.]*)",\s*\{\s*default:\s*"((?:[^"\\]|\\.)*)"/g;

const collectDefaults = (
  dir: string,
  found = new Map<string, Set<string>>(),
): Map<string, Set<string>> => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__" && entry !== "i18n") {
        collectDefaults(path, found);
      }
      continue;
    }
    if (!/\.tsx?$/.test(entry)) {
      continue;
    }
    for (const match of readFileSync(path, "utf8").matchAll(DEFAULT_PATTERN)) {
      const key = match[1] as string;
      const value = JSON.parse(`"${match[2]}"`) as string;
      found.set(key, (found.get(key) ?? new Set()).add(value));
    }
  }
  return found;
};

/** The `$1` and `{name}` placeholders of an entry, every variant included. */
const placeholders = (entry: (typeof uiEn)[string]): string[] => {
  const text =
    typeof entry === "string" ? entry : Object.values(entry).join(" ");
  return [...new Set(text.match(/\$\d+|\{\w+\}/g) ?? [])].sort();
};

describe("uiEn", () => {
  it("holds exactly the keys uiFr holds", () => {
    expect(Object.keys(uiEn).sort()).toEqual(Object.keys(uiFr).sort());
  });

  it("matches each component's literal default", () => {
    const defaults = collectDefaults(SRC);
    // Guards the guard: a pattern matching nothing would pass for nothing.
    expect(defaults.size).toBeGreaterThan(500);

    const drift = [...defaults]
      .filter(([key, values]) => {
        const entry = uiEn[key];
        return typeof entry !== "string" || !values.has(entry);
      })
      .map(
        ([key, values]) =>
          `${key}: ${JSON.stringify(uiEn[key])} vs ${[...values].map((v) => JSON.stringify(v)).join(" | ")}`,
      );
    expect(drift).toEqual([]);
  });

  it("uses the placeholders uiFr uses, key by key", () => {
    const mismatched = Object.keys(uiFr)
      .filter((key) => {
        const en = uiEn[key];
        const fr = uiFr[key];
        return (
          en === undefined ||
          fr === undefined ||
          placeholders(en).join() !== placeholders(fr).join()
        );
      })
      .sort();
    expect(mismatched).toEqual([]);
  });

  it("leaves no value empty, nor any variant of a plural entry", () => {
    const blank = Object.entries(uiEn)
      .filter(([, value]) =>
        typeof value === "string"
          ? value.trim() === ""
          : Object.values(value).some((variant) => variant.trim() === ""),
      )
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });
});

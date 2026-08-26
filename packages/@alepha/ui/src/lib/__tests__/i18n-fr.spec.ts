import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { uiFr } from "../i18n-fr.ts";

/**
 * The French catalogue must cover every `tr()` key in the package, exactly.
 *
 * Without this, the catalogue rots silently and in one direction only: a
 * component gains a key, nobody adds the translation, and the component falls
 * back to its English default — which looks deliberate. That is how the whole
 * back office came to be in English inside a French application in the first
 * place. A default is not a translation, and nothing but a test can tell the
 * difference.
 *
 * The check runs both ways. A missing key is an untranslated string; an extra one
 * is a translation for something no component asks for any more, which is dead
 * weight that makes the real gaps harder to see.
 */
const SRC = join(import.meta.dirname, "..", "..");

/**
 * Every key the package asks for, in either of the two forms it declares one.
 *
 * `tr("some.key"` / `tr(\`some.key\`` is the call site itself. `labelKey:` and
 * `groupKey:` are the declarative form the nav shell needs: a `$page`'s class
 * field is evaluated once, outside React, so a router names the key and the
 * sidebar resolves it later with `tr(nav.labelKey)` — a computed argument no
 * regex over call sites can read. Missing that form here would report every
 * nav translation as an unused extra, which is how a "coverage" check ends up
 * arguing for deleting the coverage.
 */
const KEY_PATTERNS = [
  /\btr\(\s*(?:`([a-zA-Z][\w.]*)`|"([a-zA-Z][\w.]*)")/g,
  /\b(?:labelKey|groupKey):\s*"([a-zA-Z][\w.]*)"/g,
];

const collectKeys = (dir: string, found = new Set<string>()): Set<string> => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__") {
        collectKeys(path, found);
      }
      continue;
    }
    if (!/\.tsx?$/.test(entry)) {
      continue;
    }
    const source = readFileSync(path, "utf8");
    for (const pattern of KEY_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        found.add((match[1] ?? match[2]) as string);
      }
    }
  }
  return found;
};

describe("uiFr", () => {
  const keys = collectKeys(SRC);

  it("finds the package's translatable keys at all", () => {
    // Guards the guard: a regex that silently matches nothing would make every
    // assertion below pass for the wrong reason.
    expect(keys.size).toBeGreaterThan(300);
  });

  it("finds keys declared as nav metadata, not only as tr() calls", () => {
    // The `labelKey` / `groupKey` pattern specifically: it is the only source
    // for the whole admin and account chrome, and nothing else in the suite
    // would notice it silently matching nothing.
    expect(keys).toContain("admin.nav.users");
    expect(keys).toContain("admin.nav.group.identity");
    expect(keys).toContain("account.nav.profile");
  });

  it("translates every key the components ask for", () => {
    const missing = [...keys].filter((key) => !uiFr[key]).sort();
    expect(missing).toEqual([]);
  });

  it("carries no translation for a key nothing uses", () => {
    const extra = Object.keys(uiFr)
      .filter((key) => !keys.has(key))
      .sort();
    expect(extra).toEqual([]);
  });

  it("leaves no value empty", () => {
    const blank = Object.entries(uiFr)
      .filter(([, value]) => value.trim() === "")
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });
});

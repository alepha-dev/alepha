import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nCheckService } from "../services/I18nCheckService.ts";

describe("I18nCheckService", () => {
  const ROOT = "/proj";

  const createEnv = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const service = alepha.inject(I18nCheckService);
    const fs = alepha.inject(MemoryFileSystemProvider);
    return { service, fs };
  };

  const dictionary = (keys: Record<string, string>) => {
    const body = Object.entries(keys)
      .map(([k, v]) => `        "${k}": "${v}",`)
      .join("\n");
    return `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
${body}
      },
    }),
  });
}
`;
  };

  let env: ReturnType<typeof createEnv>;
  beforeEach(() => {
    env = createEnv();
  });

  it("reports keys with no quoted reference as unused", async () => {
    await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/web/I18n.ts`,
      dictionary({ "home.title": "Home", "home.unused": "Nothing" }),
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/Home.tsx`,
      `export const Home = () => tr("home.title");`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.totalKeys).toBe(2);
    expect(result.unused).toEqual(["home.unused"]);
    expect(result.dictionaryFiles).toHaveLength(1);
  });

  it("exempts keys matching a dynamic prefix", async () => {
    await env.fs.mkdir(`${ROOT}/src`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/I18n.ts`,
      dictionary({
        "archive.type.directory": "Folder",
        "archive.type.folio": "Folio",
        "home.title": "Home",
      }),
    );
    await env.fs.writeFile(
      `${ROOT}/src/App.tsx`,
      "tr(`archive.type.${k}`); tr('home.title');",
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: ["archive.type."],
      exclude: [],
    });

    expect(result.unused).toEqual([]);
    expect(result.exemptKeys).toBe(2);
  });

  it("skips excluded paths and built-in excludes", async () => {
    await env.fs.mkdir(`${ROOT}/src/__tests__`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/I18n.ts`,
      dictionary({ "home.title": "Home" }),
    );
    // Reference lives only in an excluded test file — should not count.
    await env.fs.writeFile(
      `${ROOT}/src/__tests__/Home.spec.ts`,
      `tr("home.title");`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.unused).toEqual(["home.title"]);
  });

  it("extracts keys from lazily-imported per-language files", async () => {
    await env.fs.mkdir(`${ROOT}/src/web/i18n`, { recursive: true });
    // Marker file declares `$dictionary` but the keys live in split,
    // markerless per-language files referenced via `lazy: () => import(...)`.
    // A sibling `$page` lazy import must NOT be mistaken for a key file.
    await env.fs.writeFile(
      `${ROOT}/src/web/Router.ts`,
      `import { $dictionary } from "alepha/react/i18n";
export class Router {
  fr = $dictionary({ lazy: () => import("./i18n/fr.ts"), lang: "fr" });
  en = $dictionary({ lazy: () => import("./i18n/en.ts"), lang: "en" });
  page = $page({ lazy: () => import("./Home.tsx") });
}
`,
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/i18n/fr.ts`,
      `export default { "home.title": "Accueil", "home.unused": "Rien" };`,
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/i18n/en.ts`,
      `export default { "home.title": "Home", "home.unused": "Nothing" };`,
    );
    // The only reference — `home.unused` is dead in both languages. The
    // `"home.title": "…"` lines in the sibling language file must not count
    // as references (key files are excluded from the usage corpus).
    await env.fs.writeFile(
      `${ROOT}/src/web/Home.tsx`,
      `export const Home = () => tr("home.title");`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.totalKeys).toBe(2);
    expect(result.unused).toEqual(["home.unused"]);
    // The resolved language file is treated as a dictionary; the sibling
    // `$page` lazy import is not (it contributed no keys and stays in the
    // usage corpus). `en.ts` is also a dictionary file but adds no *new*
    // keys, so only the first contributor is listed.
    expect(result.dictionaryFiles).toContain(`${ROOT}/src/web/i18n/fr.ts`);
    expect(result.dictionaryFiles).not.toContain(`${ROOT}/src/web/Home.tsx`);
  });

  it("reports {0}-style placeholders, which never interpolate", async () => {
    await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/web/I18n.ts`,
      dictionary({
        "session.ok": "Signed out of $1 sessions.",
        "session.bad": "Signed out of {0} sessions.",
      }),
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/Home.tsx`,
      `export const Home = () => [tr("session.ok"), tr("session.bad")];`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.badPlaceholders).toEqual([
      {
        file: `${ROOT}/src/web/I18n.ts`,
        key: "session.bad",
        placeholder: "{0}",
      },
    ]);
  });

  it("attributes a placeholder to its key even when the value wraps", async () => {
    await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
    // A formatter is free to break a long entry onto its own line — the
    // placeholder is then nowhere near the key declaration.
    await env.fs.writeFile(
      `${ROOT}/src/web/I18n.ts`,
      `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        "a.short": "Fine",
        "a.wrapped":
          "A very long sentence that the formatter pushed down a line, {1}.",
      },
    }),
  });
}
`,
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/Home.tsx`,
      `export const Home = () => [tr("a.short"), tr("a.wrapped")];`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.badPlaceholders).toEqual([
      {
        file: `${ROOT}/src/web/I18n.ts`,
        key: "a.wrapped",
        placeholder: "{1}",
      },
    ]);
  });

  it("reports a tr() call passing fewer args than its key needs", async () => {
    await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/web/I18n.ts`,
      dictionary({
        "files.hint": "up to $1 files",
        "files.count": "$1 / $2 files",
        "files.plain": "Attachments",
      }),
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/Form.tsx`,
      `export const Form = () => [
         tr("files.hint"),
         tr("files.count", { args: [String(a), String(b)] }),
         tr("files.plain"),
       ];`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.missingArgs).toEqual([
      {
        key: "files.hint",
        needs: 1,
        got: 0,
        file: `${ROOT}/src/web/Form.tsx`,
      },
    ]);
  });

  it("does not flag what it cannot count, or keys that are not calls", async () => {
    await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/web/I18n.ts`,
      dictionary({
        "a.spread": "hi $1",
        "a.default": "hi $1",
        "a.listed": "hi $1",
      }),
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/Form.tsx`,
      `const nav = ["a.listed"];
       export const Form = () => [
         nav,
         tr("a.spread", { args: [...parts] }),
         tr("a.default", { args: [x], default: "hi" }),
       ];`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    // `a.spread` is unknowable, `a.default` passes one, and `a.listed` never
    // appears as a call at all — a bare key in a nav array is not a call site.
    expect(result.missingArgs).toEqual([]);
  });

  /**
   * An entry's value is read as the text up to the NEXT declaration, so a
   * comment in that gap counted as part of the entry above it. A dictionary
   * documenting its placeholders — `// "$1" = label, "$2" = range` — therefore
   * made the preceding entry demand two arguments, and a correct call site was
   * reported as passing too few. The dictionary's own documentation broke it.
   */
  it("ignores comments when measuring how many arguments an entry needs", async () => {
    await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/web/I18n.ts`,
      `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        "hours.weekend": "Sat - Sun: $1",
        // Per-day lines: "$1" = day label, "$2" = range.
        "hours.line": "$1: $2",
        /* block form, same trap: $2 */
        "hours.closed": "Closed",
      },
    }),
  });
}
`,
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/Hours.tsx`,
      `export const Hours = () => [
         tr("hours.weekend", { args: [a] }),
         tr("hours.line", { args: [a, b] }),
         tr("hours.closed"),
       ];`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.missingArgs).toEqual([]);
  });

  it("treats // inside a value as text, not as the start of a comment", async () => {
    await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/web/I18n.ts`,
      `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        "docs.link": "See https://example.com/guide for $1",
      },
    }),
  });
}
`,
    );
    await env.fs.writeFile(
      `${ROOT}/src/web/Docs.tsx`,
      `export const Docs = () => tr("docs.link");`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    // Blanking from the URL's slashes would swallow the `$1`, and this
    // genuinely-unfilled placeholder would go unreported.
    expect(result.missingArgs).toEqual([
      {
        key: "docs.link",
        needs: 1,
        got: 0,
        file: `${ROOT}/src/web/Docs.tsx`,
      },
    ]);
  });

  it("returns totalKeys=0 when no dictionary is found", async () => {
    await env.fs.mkdir(`${ROOT}/src`, { recursive: true });
    await env.fs.writeFile(
      `${ROOT}/src/App.tsx`,
      `export const App = () => "hi";`,
    );

    const result = await env.service.check({
      root: ROOT,
      scan: ["src"],
      dynamicPrefixes: [],
      exclude: [],
    });

    expect(result.totalKeys).toBe(0);
  });
});

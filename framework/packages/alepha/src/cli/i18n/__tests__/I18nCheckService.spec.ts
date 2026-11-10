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

  describe("named placeholders (#Q3331)", () => {
    const run = async (dict: string, source: string) => {
      await env.fs.mkdir(`${ROOT}/src/web`, { recursive: true });
      await env.fs.writeFile(`${ROOT}/src/web/I18n.ts`, dict);
      await env.fs.writeFile(`${ROOT}/src/web/Page.tsx`, source);
      return env.service.check({
        root: ROOT,
        scan: ["src"],
        dynamicPrefixes: [],
        exclude: [],
      });
    };

    const variantDictionary = `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        "greet.user": "Hello {name}, card {last4}",
        "files.count": {
          one: "{count} file by {owner}",
          // {ignored} sits in a comment
          other: "{count} files",
        },
        "ticket.status": { open: "Open", other: "Unknown" },
        "literal.brace": "Write {{name}} here",
        "old.style": "Hi $1",
      },
    }),
  });
}
`;

    it("reports a readable call that omits a {name} used in any variant", async () => {
      const result = await run(
        variantDictionary,
        `export const P = () => [
           tr("greet.user", { args: { name } }),
           tr("greet.user", { args: { name: user.name, last4 } }),
           tr("greet.user", { args: ["a", "b"] }),
           tr("greet.user"),
           tr("files.count", { count: n, args: { owner: "x" } }),
           tr("files.count", { count: n }),
           tr("files.count", { args: { owner } }),
           tr("ticket.status", { select: s }),
           tr("literal.brace"),
           tr("old.style", { args: ["x"] }),
         ];`,
      );

      const file = `${ROOT}/src/web/Page.tsx`;
      expect(result.missingNames).toEqual([
        { key: "greet.user", names: ["last4"], file },
        { key: "greet.user", names: ["name", "last4"], file },
        { key: "greet.user", names: ["name", "last4"], file },
        { key: "files.count", names: ["owner"], file },
        { key: "files.count", names: ["count"], file },
      ]);
      expect(result.missingArgs).toEqual([]);
      expect(result.badPlaceholders).toEqual([]);
    });

    it("leaves alone what it cannot read, and reads translate()'s positional form", async () => {
      const result = await run(
        variantDictionary,
        "export const P = () => [\n" +
          '  tr("greet.user", options),\n' +
          '  tr("greet.user", { args }),\n' +
          '  tr("greet.user", { args: { ...rest } }),\n' +
          '  tr("greet.user", { ...options }),\n' +
          '  tr("files.count", { args: values }),\n' +
          '  translate("greet.user", { name, last4 }),\n' +
          '  translate("greet.user", ["a"]),\n' +
          '  translate("files.count", { owner }, { count }),\n' +
          '  `${tr("literal.brace")}`,\n' +
          "];",
      );

      const file = `${ROOT}/src/web/Page.tsx`;
      expect(result.missingNames).toEqual([
        { key: "greet.user", names: ["name", "last4"], file },
        // `args: values` is unreadable, but no `count` is proven.
        { key: "files.count", names: ["count"], file },
      ]);
    });

    it("still refuses {0}, and ignores a template literal's ${name}", async () => {
      const result = await run(
        `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({
    lazy: async () => ({ default: { "a.num": "Count {0}" } }),
  });
  label = \`\${this.name}\`;
}
`,
        `export const P = () => tr("a.num");`,
      );

      expect(result.badPlaceholders).toEqual([
        { file: `${ROOT}/src/web/I18n.ts`, key: "a.num", placeholder: "{0}" },
      ]);
      expect(result.missingNames).toEqual([]);
    });
  });

  describe("plural categories per locale (#Q3344)", () => {
    const check = () =>
      env.service.check({
        root: ROOT,
        scan: ["src"],
        dynamicPrefixes: [],
        exclude: [],
      });

    const usage = `export const P = () => [
  tr("files.count", { count }),
  tr("ticket.state", { select: state }),
  tr("only.other", { count }),
  tr("mixed.key", { count }),
];`;

    it("checks lazily imported per-language files against their language", async () => {
      await env.fs.mkdir(`${ROOT}/src/locales`, { recursive: true });
      await env.fs.writeFile(
        `${ROOT}/src/I18n.ts`,
        `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({ lazy: () => import("./locales/en.ts") });
  fr = $dictionary({ lazy: () => import("./locales/fr.ts") });
  polish = $dictionary({ lang: "pl", lazy: () => import("./locales/pl.ts") });
  ar = $dictionary({ lazy: () => import("./locales/ar.ts") });
}
`,
      );
      await env.fs.writeFile(
        `${ROOT}/src/locales/en.ts`,
        `export default {
  "files.count": { one: "{count} file", other: "{count} files" },
  // Only CLDR names, but a call passes select: a select, left alone.
  "ticket.state": { one: "Single", other: "Shared" },
  "only.other": { other: "{count} items" },
  "mixed.key": { one: "{count} thing", other: "{count} things" },
};
`,
      );
      await env.fs.writeFile(
        `${ROOT}/src/locales/fr.ts`,
        `export default {
  // one and other: French many is allowed and not required.
  "files.count": { one: "{count} fichier", many: "{count} de fichiers", other: "{count} fichiers" },
  "ticket.state": { one: "Seul", other: "Partagé" },
  "only.other": { other: "{count} éléments" },
  "mixed.key": "{count} choses",
};
`,
      );
      await env.fs.writeFile(
        `${ROOT}/src/locales/pl.ts`,
        `export default {
  // Copied from English: few and many are missing.
  "files.count": {
    one: "{count} plik",
    other: "{count} plików",
  },
  "ticket.state": { one: "Jeden", other: "Wspólny" },
  "only.other": { other: "{count} rzeczy" },
  "mixed.key": { one: "{count} a", few: "{count} b", many: "{count} c", other: "{count} d" },
};
`,
      );
      await env.fs.writeFile(
        `${ROOT}/src/locales/ar.ts`,
        `export default {
  "files.count": {
    zero: "a", one: "b", two: "c", few: "d", many: "e", other: "f",
  },
  "ticket.state": { other: "x" },
  "only.other": { other: "x" },
  "mixed.key": { zero: "a", one: "b", two: "c", few: "d", many: "e", other: "f" },
};
`,
      );
      await env.fs.writeFile(`${ROOT}/src/Page.tsx`, usage);

      const result = await check();
      const at = (lang: string) => `${ROOT}/src/locales/${lang}.ts`;

      expect(result.pluralIssues).toEqual([
        {
          severity: "error",
          kind: "missing",
          key: "files.count",
          lang: "pl",
          categories: ["few", "many"],
          file: at("pl"),
        },
        {
          severity: "error",
          kind: "missing",
          key: "only.other",
          lang: "en",
          categories: ["one"],
          file: at("en"),
        },
        {
          severity: "error",
          kind: "missing",
          key: "only.other",
          lang: "fr",
          categories: ["one"],
          file: at("fr"),
        },
        {
          severity: "error",
          kind: "missing",
          key: "only.other",
          lang: "pl",
          categories: ["one", "few", "many"],
          file: at("pl"),
        },
        {
          severity: "error",
          kind: "missing",
          key: "only.other",
          lang: "ar",
          categories: ["zero", "one", "two", "few", "many"],
          file: at("ar"),
        },
        ...["en", "pl", "ar"].map((lang) => ({
          severity: "error",
          kind: "mixed",
          key: "mixed.key",
          lang,
          categories: ["fr"],
          file: at(lang),
        })),
      ]);
    });

    it("reads an inline dictionary with two languages in one file, wrapped and commented", async () => {
      await env.fs.mkdir(`${ROOT}/src`, { recursive: true });
      await env.fs.writeFile(
        `${ROOT}/src/I18n.ts`,
        `import { $dictionary } from "alepha/react/i18n";
export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        "files.count": {
          one: "{count} file", // the singular
          /* two: "never" */
          other: "{count} files",
          few: "{count} files (few)",
        },
      },
    }),
  });

  pl = $dictionary({
    lazy: async () => ({
      default: {
        "files.count": { one: "a", few: "b", other: "d" },
      },
    }),
  });
}
`,
      );
      await env.fs.writeFile(
        `${ROOT}/src/Page.tsx`,
        `export const P = () => tr("files.count", { count });`,
      );

      const result = await check();

      expect(result.pluralIssues).toEqual([
        {
          severity: "warning",
          kind: "unexpected",
          key: "files.count",
          lang: "en",
          categories: ["few"],
          file: `${ROOT}/src/I18n.ts`,
        },
        {
          severity: "error",
          kind: "missing",
          key: "files.count",
          lang: "pl",
          categories: ["many"],
          file: `${ROOT}/src/I18n.ts`,
        },
      ]);
    });

    it("skips a spread record, which has no provable language, and leaves a select alone", async () => {
      await env.fs.mkdir(`${ROOT}/src/i18n`, { recursive: true });
      await env.fs.writeFile(
        `${ROOT}/src/i18n/kitPl.ts`,
        `export const kitPl = {
  "kit.count": { one: "{count} a", other: "{count} b" },
};
`,
      );
      await env.fs.writeFile(
        `${ROOT}/src/I18n.ts`,
        `import { $dictionary } from "alepha/react/i18n";
import { kitPl } from "./i18n/kitPl.ts";
export const kitEn = {
  "kit.count": { one: "{count} a", other: "{count} b" },
};
export class I18n {
  pl = $dictionary({
    lazy: async () => ({
      default: {
        ...kitPl,
        "ticket.status": { open: "Otwarte", other: "Nieznany" },
      },
    }),
  });
}
`,
      );
      await env.fs.writeFile(
        `${ROOT}/src/Page.tsx`,
        `export const P = () => [tr("kit.count", { count }), tr("ticket.status", { select })];`,
      );

      const result = await check();

      // `kitEn` sits outside every $dictionary call: no language, no check.
      expect(result.pluralIssues).toEqual([]);
    });
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

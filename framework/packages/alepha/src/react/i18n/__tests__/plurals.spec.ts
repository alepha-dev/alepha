import { $inject, Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { AlephaServerCookies } from "alepha/server/cookies";
import { describe, expect, it } from "vitest";

import { AlephaReactI18n } from "../index.ts";
import {
  $dictionary,
  type DictionaryEntry,
} from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * A variant entry is chosen by a count through the `Intl.PluralRules` of the
 * entry's own language (#Q3330). Each language below writes one variant per
 * category it selects for integers, and names it after the category, so the
 * rendered text says which one the rules picked.
 */
const files = {
  en: { one: "{count} en-one", other: "{count} en-other" },
  fr: { one: "{count} fr-one", other: "{count} fr-other" },
  pl: {
    one: "{count} pl-one",
    few: "{count} pl-few",
    many: "{count} pl-many",
    other: "{count} pl-other",
  },
  ar: {
    zero: "{count} ar-zero",
    one: "{count} ar-one",
    two: "{count} ar-two",
    few: "{count} ar-few",
    many: "{count} ar-many",
    other: "{count} ar-other",
  },
} satisfies Record<string, DictionaryEntry>;

class App {
  en = $dictionary({
    lazy: async () => ({
      default: {
        files: files.en,
        "only.en": {
          one: "{count} only-en-one",
          other: "{count} only-en-other",
        },
        "with.args": {
          one: "$1 has {count} file",
          other: "$1 has {count} files",
        },
        plain: "{count} plain $1",
        "no.count": "no count here",
      },
    }),
  });
  fr = $dictionary({ lazy: async () => ({ default: { files: files.fr } }) });
  pl = $dictionary({
    lazy: async () => ({
      default: {
        files: files.pl,
        // Lacks `few` and `many`: those counts render `other`.
        partial: { one: "{count} partial-one", other: "{count} partial-other" },
      },
    }),
  });
  ar = $dictionary({ lazy: async () => ({ default: { files: files.ar } }) });
}

const create = async (lang?: string) => {
  const alepha = Alepha.create().with(AlephaReactI18n);
  alepha.inject(App);
  const i18n = alepha.inject(I18nProvider);
  await alepha.start();
  if (lang) {
    alepha.store.set("alepha.react.i18n.lang", lang);
  }
  return i18n;
};

const counts = [0, 1, 2, 5, 22, 1.5];

describe("$dictionary plurals", () => {
  it.each([
    ["en", ["other", "one", "other", "other", "other", "other"]],
    ["fr", ["one", "one", "other", "other", "other", "one"]],
    ["pl", ["many", "one", "few", "many", "few", "other"]],
    ["ar", ["zero", "one", "two", "few", "many", "other"]],
  ])(
    "selects the %s categories for 0, 1, 2, 5, 22 and 1.5",
    async (lang, expected) => {
      const i18n = await create(lang);

      const categories = counts.map((count) =>
        i18n.tr("files", { count }).split(" ")[1]?.replace(`${lang}-`, ""),
      );

      expect(categories).toEqual(expected);
    },
  );

  it("selects with the rules of the entry's language, not the active one", async () => {
    // A Polish page reaching an English entry through the fallback: 2 is
    // `few` in Polish, `other` in English, and the text is English.
    const i18n = await create("pl");

    expect(i18n.tr("only.en", { count: 2 })).toBe("2 only-en-other");
    expect(i18n.tr("only.en", { count: 1 })).toBe("1 only-en-one");
    expect(i18n.tr("only.en", { count: 5 })).toBe("5 only-en-other");
  });

  it("falls back to other for a category the entry lacks", async () => {
    const i18n = await create("pl");

    expect(i18n.tr("partial", { count: 2 })).toBe("2 partial-other");
    expect(i18n.tr("partial", { count: 1 })).toBe("1 partial-one");
  });

  it("renders other for a variant entry read without a count", async () => {
    const i18n = await create("en");

    expect(i18n.tr("files")).toBe("{count} en-other");
    expect(i18n.translate("files")).toBe("{count} en-other");
  });

  it("takes the count in translate()", async () => {
    const i18n = await create("pl");

    expect(i18n.translate("files", [], { count: 3 })).toBe("3 pl-few");
  });

  it("formats {count} for the entry's language", async () => {
    const en = await create("en");
    expect(en.tr("files", { count: 1234 })).toBe("1,234 en-other");

    const fr = await create("fr");
    expect(fr.tr("files", { count: 1234 })).toBe(
      `${new Intl.NumberFormat("fr").format(1234)} fr-other`,
    );
    expect(fr.tr("files", { count: 1234 })).not.toBe("1234 fr-other");
  });

  it("keeps $N working inside a variant", async () => {
    const i18n = await create("en");

    expect(i18n.tr("with.args", { count: 1, args: ["Ada"] })).toBe(
      "Ada has 1 file",
    );
    expect(i18n.tr("with.args", { count: 3, args: ["Ada"] })).toBe(
      "Ada has 3 files",
    );
  });

  it("fills {count} in a plain string given a count, and leaves it otherwise", async () => {
    const i18n = await create("en");

    expect(i18n.tr("plain", { count: 4, args: ["x"] })).toBe("4 plain x");
    expect(i18n.tr("plain", { args: ["x"] })).toBe("{count} plain x");
    expect(i18n.tr("no.count", { count: 4 })).toBe("no count here");
  });

  it("selects a default variant object with the fallback language's rules", async () => {
    const i18n = await create("pl");

    expect(
      i18n.tr("nope.missing", {
        count: 2,
        default: { one: "{count} file", other: "{count} files" },
      }),
    ).toBe("2 files");
    expect(
      i18n.tr("nope.missing", {
        count: 1,
        default: { one: "{count} file", other: "{count} files" },
      }),
    ).toBe("1 file");
  });

  it("does not throw on an active language that is not a language tag", async () => {
    const i18n = await create("garbage!!");

    expect(i18n.tr("files", { count: 1 })).toBe("1 en-one");
    expect(i18n.tr("files", { count: 2 })).toBe("2 en-other");
  });

  it("selects other for a dictionary language Intl refuses", async () => {
    class Odd {
      odd = $dictionary({
        lang: "not a tag!!",
        lazy: async () => ({
          default: { files: { one: "{count} one", other: "{count} other" } },
        }),
      });
    }
    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(Odd);
    const i18n = alepha.inject(I18nProvider);
    await alepha.start();
    alepha.store.set("alepha.react.i18n.lang", "not a tag!!");

    expect(i18n.tr("files", { count: 1 })).toBe("1 other");
  });

  describe("on the server", () => {
    class Server {
      protected i18n = $inject(I18nProvider);

      en = $dictionary({
        lazy: async () => ({ default: { files: files.en } }),
      });
      fr = $dictionary({
        lazy: async () => ({ default: { files: files.fr } }),
      });
      pl = $dictionary({
        lazy: async () => ({ default: { files: files.pl } }),
      });

      probe = $action({
        path: "/probe",
        method: "GET",
        schema: { response: z.text() },
        handler: async () => {
          // Yield, so two concurrent requests interleave inside the handler.
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [0, 1, 2, 5]
            .map((count) => this.i18n.tr("files", { count }))
            .join("|");
        },
      });
    }

    const start = async () => {
      const alepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaServerCookies)
        .with(AlephaReactI18n)
        .with(Server);
      await alepha.start();
      const server = alepha.inject(Server);
      const fetchAs = async (cookie: string) =>
        (
          await server.probe.fetch(
            {},
            { request: { headers: { cookie, "accept-language": "en-US" } } },
          )
        ).data;
      return fetchAs;
    };

    it("gives two concurrent requests in fr and pl their own categories", async () => {
      const fetchAs = await start();

      const [fr, pl] = await Promise.all([
        fetchAs("lang=%22fr%22"),
        fetchAs("lang=%22pl%22"),
      ]);

      expect(fr).toBe("0 fr-one|1 fr-one|2 fr-other|5 fr-other");
      expect(pl).toBe("0 pl-many|1 pl-one|2 pl-few|5 pl-many");
    });

    it("renders, and does not throw, when the lang cookie is not a language tag", async () => {
      const fetchAs = await start();

      expect(await fetchAs("lang=%22garbage!!%22")).toBe(
        "0 en-other|1 en-one|2 en-other|5 en-other",
      );
    });
  });

  describe("types", () => {
    it("refuses a variant object without other", async () => {
      // A typed catalog: the error is on the entry itself.
      const typed: Record<string, DictionaryEntry> = {
        // @ts-expect-error `other` is required
        "a.b": { one: "x" },
      };

      // An untyped catalog (what `import("./en.ts")` of a bare
      // `export default { ... }` gives): the error is at the `$dictionary`
      // call, on its `lazy`.
      class Untyped {
        en = $dictionary({
          // @ts-expect-error `other` is required
          lazy: async () => ({ default: { "a.b": { one: "x" } } }),
        });
      }

      const i18n = await create("en");
      // @ts-expect-error `other` is required in a default too
      const fromDefault = () => i18n.tr("nope", { default: { one: "x" } });

      void typed;
      void Untyped;
      void fromDefault;
    });

    it("accepts a string-only catalog unchanged", async () => {
      const strings: Record<string, string> = { "a.b": "x" };
      class Strings {
        en = $dictionary({ lazy: async () => ({ default: strings }) });
      }
      const alepha = Alepha.create().with(AlephaReactI18n);
      alepha.inject(Strings);
      const i18n = alepha.inject(I18nProvider);
      await alepha.start();

      expect(i18n.tr("a.b")).toBe("x");
    });
  });
});

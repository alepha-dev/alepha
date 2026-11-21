import { $inject, Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { AlephaServerCookies } from "alepha/server/cookies";
import { describe, expect, it } from "vitest";

import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";
import { RequestLangResolver } from "../services/RequestLangResolver.ts";

/**
 * A request names its language three ways (URL prefix, `lang` cookie,
 * `Accept-Language`), and all three are the client's to write. Whatever they
 * hold, the language of the request is one the app declared.
 */
describe("the language of a request", () => {
  class App {
    i18n = $inject(I18nProvider);
    en = $dictionary({ lazy: async () => ({ default: {} }) });
    fr = $dictionary({ lazy: async () => ({ default: {} }) });
    de = $dictionary({ lazy: async () => ({ default: {} }) });

    lang = $action({
      path: "/lang",
      method: "GET",
      schema: { response: z.text() },
      handler: () => this.i18n.lang,
    });

    number = $action({
      path: "/number",
      method: "GET",
      schema: { response: z.text() },
      handler: () => this.i18n.l(1234.5),
    });

    cached = $action({
      path: "/cached",
      method: "GET",
      schema: { response: z.text() },
      handler: () =>
        [
          this.i18n.numberFormat.format(1234.5),
          this.i18n.dateFormat.format(new Date("2026-01-15T12:00:00Z")),
        ].join(" "),
    });
  }

  const start = async () => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCookies)
      .with(AlephaReactI18n)
      .with(App);
    await alepha.start();
    const app = alepha.inject(App);
    const call = async (
      action: { fetch: (...args: any[]) => Promise<{ data: unknown }> },
      headers: Record<string, string>,
    ) => (await action.fetch({}, { request: { headers } })).data;
    return { app, call };
  };

  const cookie = (lang: string) => ({
    cookie: `lang=${encodeURIComponent(JSON.stringify(lang))}`,
  });

  describe("the lang cookie", () => {
    it("is the language when the app declares it", async () => {
      const { app, call } = await start();

      expect(await call(app.lang, cookie("fr"))).toBe("fr");
    });

    it("is ignored when it is not a language tag, and l() answers", async () => {
      const { app, call } = await start();

      expect(await call(app.lang, cookie("en_US"))).toBe("en");
      expect(await call(app.number, cookie("en_US"))).toBe("1,234.5");
    });

    it("is ignored when the app does not declare it", async () => {
      const { app, call } = await start();

      expect(await call(app.lang, cookie("es"))).toBe("en");
    });

    it("gives way to Accept-Language when it is ignored", async () => {
      const { app, call } = await start();

      expect(
        await call(app.lang, { ...cookie("es"), "accept-language": "fr" }),
      ).toBe("fr");
    });
  });

  describe("Accept-Language", () => {
    it("takes the first declared language of the list, not its first tag", async () => {
      const { app, call } = await start();

      expect(
        await call(app.lang, {
          "accept-language": "it-CH,fr-CH;q=0.9,en;q=0.8",
        }),
      ).toBe("fr");
    });

    it("orders the list by quality", async () => {
      const { app, call } = await start();

      expect(
        await call(app.lang, {
          "accept-language": "en;q=0.5, de;q=0.9, fr;q=0",
        }),
      ).toBe("de");
    });
  });

  describe("RequestLangResolver.resolve", () => {
    const resolve = (
      headerLang: string | undefined,
      languages: string[],
      rest: { cookieLang?: string; urlLocale?: string } = {},
    ) =>
      RequestLangResolver.resolve({
        headerLang: RequestLangResolver.fromHeader(headerLang),
        languages,
        fallbackLang: languages[0],
        autoDetect: true,
        ...rest,
      });

    it("matches a tag whatever its case, and answers the declared spelling", () => {
      expect(resolve("fr-fr", ["en", "fr-FR"])).toBe("fr-FR");
      expect(resolve("FR", ["en", "fr"])).toBe("fr");
    });

    it("truncates a tag one subtag at a time", () => {
      expect(resolve("zh-Hant-TW", ["en", "zh", "zh-Hant"])).toBe("zh-Hant");
      expect(resolve("zh-Hant-TW", ["en", "zh"])).toBe("zh");
    });

    it("skips a wildcard, a refused tag and an empty item", () => {
      expect(resolve("*, , fr;q=0, de;q=0.1", ["en", "fr", "de"])).toBe("de");
      expect(resolve("*", ["en", "fr"])).toBe("en");
    });

    it("answers the declared spelling of a cookie, and ignores an undeclared one", () => {
      expect(resolve(undefined, ["en", "fr-FR"], { cookieLang: "fr-fr" })).toBe(
        "fr-FR",
      );
      expect(
        resolve(undefined, ["en", "fr"], { cookieLang: '"><script>' }),
      ).toBe("en");
    });

    it("ignores a URL locale the app does not declare", () => {
      expect(resolve(undefined, ["en", "fr"], { urlLocale: "xx" })).toBe("en");
      expect(resolve(undefined, ["en", "fr"], { urlLocale: "fr" })).toBe("fr");
    });

    it("stays self-contained, since the edge worker embeds its source", () => {
      // oxlint-disable-next-line typescript/no-implied-eval
      const embedded = new Function(
        `return ${RequestLangResolver.resolve.toString()}`,
      )() as typeof RequestLangResolver.resolve;

      expect(
        embedded({
          headerLang: "it,fr;q=0.9",
          languages: ["en", "fr"],
          fallbackLang: "en",
          autoDetect: true,
        }),
      ).toBe("fr");
    });
  });

  describe("formatting", () => {
    it("formats each request in its own language", async () => {
      const { app, call } = await start();

      expect(await call(app.cached, cookie("de"))).toBe("1.234,5 15.1.2026");
      expect(await call(app.cached, cookie("fr"))).toBe("1 234,5 15/01/2026");
      expect(await call(app.cached, cookie("en"))).toBe("1,234.5 1/15/2026");
    });

    it("never throws on a language Intl refuses", async () => {
      const alepha = Alepha.create().with(AlephaReactI18n);
      const i18n = alepha.inject(I18nProvider);
      await alepha.start();

      await i18n.setLang("en_US");

      expect(i18n.l(1234.5)).toBe("1,234.5");
      expect(i18n.l(new Date("2026-01-15T12:00:00Z"))).toBe("1/15/2026");
      expect(
        i18n.l(new Date("2026-01-15T12:00:00Z"), { date: { month: "long" } }),
      ).toBe("January");
      expect(i18n.numberFormat.format(1234.5)).toBe("1,234.5");
    });
  });

  /**
   * A language with no translation of its own, used for its direction and
   * its formats, is declared like any other: with a dictionary, empty here.
   */
  describe("a language declared with an empty dictionary", () => {
    class Rtl {
      i18n = $inject(I18nProvider);
      en = $dictionary({ lazy: async () => ({ default: { hi: "Hello" } }) });
      ar = $dictionary({ lazy: async () => ({ default: {} }) });

      page = $action({
        path: "/page",
        method: "GET",
        schema: { response: z.text() },
        handler: () =>
          [
            this.i18n.lang,
            this.i18n.dir,
            this.i18n.tr("hi"),
            this.i18n.l("2026-01-15T12:00:00Z", { date: { month: "long" } }),
          ].join("|"),
      });
    }

    it("gets its lang, its direction and its formats, and the fallback's text", async () => {
      const alepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaServerCookies)
        .with(AlephaReactI18n)
        .with(Rtl);
      await alepha.start();

      const { data } = await alepha
        .inject(Rtl)
        .page.fetch({}, { request: { headers: cookie("ar") } });

      const january = new Intl.DateTimeFormat("ar", { month: "long" }).format(
        new Date("2026-01-15T12:00:00Z"),
      );
      expect(january).not.toBe("January");
      expect(data).toBe(`ar|rtl|Hello|${january}`);
    });
  });

  describe("a catalog entry", () => {
    it("is missing when it is an object with no `other`", async () => {
      class Nested {
        en = $dictionary({
          lazy: async () => ({
            default: { menu: { open: "Open" } } as any,
          }),
        });
      }
      const alepha = Alepha.create().with(AlephaReactI18n);
      alepha.inject(Nested);
      const i18n = alepha.inject(I18nProvider);
      await alepha.start();

      expect(i18n.tr("menu")).toBe("menu");
      expect(i18n.tr("menu", { default: "Menu" })).toBe("Menu");
    });
  });
});

import { $inject, Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { AlephaServerCookies } from "alepha/server/cookies";
import { describe, expect, it } from "vitest";

import { HeadProvider } from "../../head/providers/HeadProvider.ts";
import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * `<html lang>` has to name the language the page is actually written in.
 *
 * It was hardcoded to `en` in both places `HeadProvider` fills it, and nothing
 * in the i18n module ever corrected it, so a French page announced itself as
 * English to every screen reader and every crawler.
 */
describe("i18n and the html lang attribute", () => {
  class App {
    en = $dictionary({ lazy: async () => ({ default: { hello: "Hello" } }) });
    fr = $dictionary({ lazy: async () => ({ default: { hello: "Bonjour" } }) });
  }

  const create = async () => {
    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);
    const head = alepha.inject(HeadProvider);
    await alepha.start();

    return { alepha, i18n, head };
  };

  it("should announce the resolved language", async () => {
    const { alepha, head } = await create();
    alepha.store.set("alepha.react.i18n.lang", "fr");

    expect(head.resolveGlobalHead().htmlAttributes?.lang).toBe("fr");
  });

  it("should announce the resolved language on a filled head", async () => {
    const { alepha, head } = await create();
    alepha.store.set("alepha.react.i18n.lang", "fr");

    const state = { head: {}, layers: [] };
    head.fillHead(state);

    expect(state.head).toMatchObject({ htmlAttributes: { lang: "fr" } });
  });

  it("should follow a language change", async () => {
    const { alepha, head, i18n } = await create();

    alepha.store.set("alepha.react.i18n.lang", "fr");
    expect(head.resolveGlobalHead().htmlAttributes?.lang).toBe("fr");

    await i18n.setLang("en");
    expect(head.resolveGlobalHead().htmlAttributes?.lang).toBe("en");
  });

  it("should fall back to the fallback language", async () => {
    const { head } = await create();

    // Nothing resolved: `I18nProvider.lang` answers `fallbackLang`, and the
    // markup must say the same thing the render used.
    expect(head.resolveGlobalHead().htmlAttributes?.lang).toBe("en");
  });

  describe("dir (#Q3350)", () => {
    class Rtl {
      en = $dictionary({ lazy: async () => ({ default: { hello: "Hello" } }) });
      ar = $dictionary({ lazy: async () => ({ default: { hello: "مرحبا" } }) });
    }

    it.each([
      ["ar", "rtl"],
      ["ar-EG", "rtl"],
      ["he", "rtl"],
      ["he_IL", "rtl"],
      ["fa", "rtl"],
      ["fa-IR", "rtl"],
      ["ur", "rtl"],
      ["ur-PK", "rtl"],
      ["ckb", "rtl"],
      ["en", "ltr"],
      ["fr-CA", "ltr"],
      ["arn", "ltr"],
      ["garbage!!", "ltr"],
      ["", "ltr"],
    ])("is the direction of %s: %s", async (lang, dir) => {
      const { alepha, i18n } = await create();
      alepha.store.set("alepha.react.i18n.lang", lang);

      expect(i18n.dir).toBe(dir);
    });

    it("is written beside lang, ltr included", async () => {
      const { alepha, head } = await create();

      expect(head.resolveGlobalHead().htmlAttributes).toMatchObject({
        lang: "en",
        dir: "ltr",
      });

      alepha.store.set("alepha.react.i18n.lang", "ar");
      const state = { head: {}, layers: [] };
      head.fillHead(state);
      expect(state.head).toMatchObject({
        htmlAttributes: { lang: "ar", dir: "rtl" },
      });
    });

    it("is written for each request's language on the server", async () => {
      class Server {
        protected head = $inject(HeadProvider);

        en = $dictionary({ lazy: async () => ({ default: {} }) });
        ar = $dictionary({ lazy: async () => ({ default: {} }) });

        probe = $action({
          path: "/probe",
          method: "GET",
          schema: { response: z.text() },
          handler: () =>
            JSON.stringify(this.head.resolveGlobalHead().htmlAttributes),
        });
      }
      const alepha = Alepha.create()
        .with(AlephaServer)
        .with(AlephaServerCookies)
        .with(AlephaReactI18n)
        .with(Server);
      await alepha.start();
      const server = alepha.inject(Server);
      const probe = async (cookie: string) =>
        JSON.parse(
          (
            await server.probe.fetch(
              {},
              { request: { headers: { cookie, "accept-language": "en" } } },
            )
          ).data,
        );

      const [ar, en] = await Promise.all([
        probe("lang=%22ar%22"),
        probe("lang=%22en%22"),
      ]);
      expect(ar).toMatchObject({ lang: "ar", dir: "rtl" });
      expect(en).toMatchObject({ lang: "en", dir: "ltr" });
    });

    it("leaves an explicit htmlAttributes.dir alone", async () => {
      const alepha = Alepha.create().with(AlephaReactI18n);
      alepha.inject(Rtl);
      const head = alepha.inject(HeadProvider);
      head.global = [
        ...(head.global ?? []),
        { htmlAttributes: { dir: "ltr" } },
      ];
      await alepha.start();
      alepha.store.set("alepha.react.i18n.lang", "ar");

      expect(head.resolveGlobalHead().htmlAttributes).toMatchObject({
        lang: "ar",
        dir: "ltr",
      });
    });
  });

  it("should leave an explicit htmlAttributes.lang alone", async () => {
    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const head = alepha.inject(HeadProvider);
    // Declared after the i18n entry, the way an app's own $head would be.
    head.global = [...(head.global ?? []), { htmlAttributes: { lang: "de" } }];
    await alepha.start();
    alepha.store.set("alepha.react.i18n.lang", "fr");

    expect(head.resolveGlobalHead().htmlAttributes?.lang).toBe("de");
  });
});

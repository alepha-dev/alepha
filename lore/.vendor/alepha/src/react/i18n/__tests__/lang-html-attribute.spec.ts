import { Alepha } from "alepha";
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
    head.fillHead(state as any);

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

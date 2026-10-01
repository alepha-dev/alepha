import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";

import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * Choosing a language in cookie mode does not navigate, so nothing re-renders
 * the head: `<html lang>` kept naming the language the page was loaded in
 * however many times the visitor switched.
 */
describe("html lang in the browser", () => {
  class App {
    en = $dictionary({ lazy: async () => ({ default: { hello: "Hello" } }) });
    fr = $dictionary({ lazy: async () => ({ default: { hello: "Bonjour" } }) });
  }

  beforeEach(() => {
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("lang");
  });

  it("should update the attribute when the language changes", async () => {
    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);
    await alepha.start();

    await i18n.setLang("fr");
    expect(document.documentElement.getAttribute("lang")).toBe("fr");

    await i18n.setLang("en");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });
});

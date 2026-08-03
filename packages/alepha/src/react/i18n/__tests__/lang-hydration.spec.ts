import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { AlephaReactI18n } from "../index.ts";

/**
 * The language the server resolved has to reach the browser.
 *
 * It did not. `alepha.react.i18n.lang` was a plain `State` key, and hydration
 * serializes only `store.exportAtoms()` — so the server detected a language from
 * `Accept-Language`, rendered in it, and told the client nothing. The client then
 * looked for the `lang` cookie (absent on a first visit, because the cookie is
 * only written when somebody *chooses* a language), found none, and started from
 * `fallbackLang`.
 *
 * The visible result on a bilingual site was the first page rendering in one
 * language and repainting in another: `lang="en"` in the markup, French in the
 * DOM, React error #418 in the console. Every visitor arriving from a link or a
 * search engine got it, and nobody whose browser asked for the fallback language
 * ever saw it — which is why it survived a full e2e suite and was only caught by
 * looking at the deployed site.
 *
 * These assertions are on the export, not on a browser: what hydration carries is
 * exactly what `exportAtoms` returns.
 */
describe("i18n language hydration", () => {
  it("exports the resolved language so the client can start where the server left off", () => {
    const alepha = Alepha.create().with(AlephaReactI18n);

    alepha.store.set("alepha.react.i18n.lang", "en");

    expect(alepha.store.exportAtoms()).toMatchObject({
      "alepha.react.i18n.lang": "en",
    });
  });

  it("exports nothing when no language has been resolved", () => {
    const alepha = Alepha.create().with(AlephaReactI18n);

    // Unset must stay unset: an exported `undefined` would pin the client to a
    // value the server never chose, and `fallbackLang` is what should apply.
    expect(alepha.store.exportAtoms()).not.toHaveProperty(
      "alepha.react.i18n.lang",
    );
  });
});

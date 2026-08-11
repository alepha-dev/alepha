import { $inject, Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { AlephaServerCookies } from "alepha/server/cookies";
import { describe, expect, it } from "vitest";
import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

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

  /**
   * Choosing a language writes the `lang` cookie from the BROWSER, and every
   * later request resolves it on the SERVER — so the two sides have to agree on
   * the cookie's name.
   *
   * They did not. The server namespaces cookie names with `APP_NAME`, the
   * browser variant cannot (`APP_NAME` is neither bundled nor hydrated), so the
   * browser wrote `lang` while the server looked for `myapp.lang`. An explicit
   * choice never survived a page load: SSR kept rendering in the
   * `Accept-Language` language and the browser repainted to the chosen one —
   * the same hydration mismatch the cookie exists to prevent. The cookie now
   * declares `prefix: false`, which is what that option is for.
   */
  it("honours a lang cookie written by the browser, under its bare name", async () => {
    class App {
      protected i18n = $inject(I18nProvider);

      fr = $dictionary({ lazy: async () => ({ default: {} }) });
      en = $dictionary({ lazy: async () => ({ default: {} }) });

      probe = $action({
        schema: { response: z.text() },
        handler: () => this.i18n.lang,
      });
    }

    const alepha = Alepha.create({ env: { APP_NAME: "AppA" } })
      .with(AlephaServer)
      .with(AlephaServerCookies)
      .with(AlephaReactI18n)
      .with(App);

    await alepha.start();

    // The bare name, JSON- then URI-encoded: exactly what the browser variant
    // leaves in document.cookie. Accept-Language deliberately disagrees, so a
    // cookie that fails to resolve falls through to "en" and the test fails.
    const response = await alepha.inject(App).probe.fetch(
      {},
      {
        request: {
          headers: { cookie: "lang=%22fr%22", "accept-language": "en-US" },
        },
      },
    );

    expect(response.data).toBe("fr");
  });
});

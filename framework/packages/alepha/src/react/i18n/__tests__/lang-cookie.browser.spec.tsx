import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { afterEach, describe, expect, it } from "vitest";

import { AlephaReactI18n, Localize } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * The browser reads the `lang` cookie at boot and writes it on a switch. The
 * cookie is unprefixed, so another app on the same host may have written it.
 */
describe("the lang cookie in the browser", () => {
  const setCookie = (lang: string) => {
    document.cookie = `lang=${encodeURIComponent(JSON.stringify(lang))}; Path=/`;
  };

  const readCookie = () =>
    document.cookie
      .split("; ")
      .find((it) => it.startsWith("lang="))
      ?.slice("lang=".length);

  afterEach(() => {
    document.cookie = "lang=; Path=/; Max-Age=0";
  });

  /**
   * Dictionaries whose `fr` and `de` loads settle when the test says so.
   */
  const createApp = () => {
    type Loaded = { default: Record<string, string> };
    const settle: Record<
      string,
      { resolve: (value: Loaded) => void; reject: (error: Error) => void }
    > = {};
    const loaded = new Set<string>();
    const pending = (lang: string) =>
      loaded.has(lang)
        ? Promise.resolve({ default: { k: lang } })
        : new Promise<Loaded>((resolve, reject) => {
            settle[lang] = { resolve, reject };
          });

    class App {
      en = $dictionary({ lazy: async () => ({ default: { k: "en" } }) });
      fr = $dictionary({ lazy: () => pending("fr") });
      de = $dictionary({ lazy: () => pending("de") });
    }

    return {
      App,
      // Before the load is asked for, it will answer at once.
      load: (lang: string) => {
        loaded.add(lang);
        settle[lang]?.resolve({ default: { k: lang } });
      },
      fail: (lang: string) => settle[lang].reject(new Error(`no ${lang}`)),
    };
  };

  const start = async () => {
    const app = createApp();
    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(app.App);
    const i18n = alepha.inject(I18nProvider);
    const started = alepha.start();
    return { alepha, i18n, started, ...app };
  };

  it("boots in the cookie's language when the app declares it", async () => {
    setCookie("de");

    const { i18n, started, load } = await start();
    load("de");
    await started;

    expect(i18n.lang).toBe("de");
    expect(i18n.tr("k")).toBe("de");
  });

  it("ignores a cookie that is not a language of the app, and renders", async () => {
    setCookie("en_US");

    const { alepha, i18n, started } = await start();
    await started;
    const view = render(
      <AlephaContext value={alepha}>
        <Localize value={1234.5} />
      </AlephaContext>,
    );

    expect(i18n.lang).toBe("en");
    expect(view.container.textContent).toBe("1,234.5");
  });

  it("keeps the last language asked for, whichever dictionary loads last", async () => {
    const { i18n, started, load } = await start();
    await started;

    const fr = i18n.setLang("fr");
    const de = i18n.setLang("de");
    load("de");
    await de;
    load("fr");
    await fr;

    expect(i18n.lang).toBe("de");
    expect(i18n.tr("k")).toBe("de");
    expect(readCookie()).toBe(encodeURIComponent(JSON.stringify("de")));
  });

  it("keeps the earlier language when the later one fails to load, and says so", async () => {
    const { i18n, started, load, fail } = await start();
    await started;

    const fr = i18n.setLang("fr");
    const de = i18n.setLang("de");
    fail("de");
    await expect(de).rejects.toThrow("no de");
    load("fr");
    await fr;

    expect(i18n.lang).toBe("fr");
    expect(i18n.tr("k")).toBe("fr");
    expect(readCookie()).toBe(encodeURIComponent(JSON.stringify("fr")));
  });
});

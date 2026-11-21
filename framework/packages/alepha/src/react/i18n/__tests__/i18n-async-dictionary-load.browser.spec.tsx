import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { useI18n } from "../hooks/useI18n.ts";
import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

describe("i18n async dictionary load", () => {
  it("should re-render consumers once a lazily-loaded dictionary arrives", async () => {
    // In the browser only the active + fallback dictionaries are loaded at
    // start. Setting the lang atom directly (what the locale router and any
    // app code that writes the atom does) loads the missing dictionary
    // asynchronously, and the provider's handler finishes before any React
    // subscriber of the atom is notified: consumers render the loaded
    // dictionary, never the raw key.
    const Greeting = () => {
      const { tr } = useI18n();
      return <div data-testid="greeting">{tr("hello")}</div>;
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { hello: "Bonjour" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <Greeting />
      </AlephaContext.Provider>,
    );

    expect(ui.getByTestId("greeting").textContent).toBe("Hello");

    act(() => {
      alepha.store.set("alepha.react.i18n.lang", "fr");
    });

    await waitFor(() =>
      expect(ui.getByTestId("greeting").textContent).toBe("Bonjour"),
    );
  });

  it("should load a dictionary that resolves to an empty catalog exactly once", async () => {
    // "Already loaded" used to be inferred from
    // `Object.keys(translations).length`, so a catalog that legitimately
    // resolves to `{}` read as never-loaded and its loader re-ran on every
    // single switch to that language, forever.
    let frLoads = 0;

    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });

      fr = $dictionary({
        lazy: async () => {
          frLoads++;
          return { default: {} };
        },
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const i18n = alepha.inject(I18nProvider);
    // A real wait, on purpose: what is asserted is that nothing more happens
    // (no second load), and there is no event for that.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

    for (const lang of ["fr", "en", "fr"]) {
      alepha.store.set("alepha.react.i18n.lang", lang);
      await settle();
    }

    expect(i18n.lang).toBe("fr");
    expect(frLoads).toBe(1);
  });
});

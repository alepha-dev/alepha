import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { afterEach, describe, it } from "vitest";

import { useI18n } from "../hooks/useI18n.ts";
import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";

describe("useI18n hook", () => {
  // `setLang` writes the `lang` cookie, and jsdom keeps one document for the
  // whole file: left there, each test would boot in the previous one's
  // language.
  afterEach(() => {
    document.cookie = "lang=; Path=/; Max-Age=0";
  });

  const renderWithAlepha = (alepha: Alepha, element: ReactNode) => {
    return render(
      <AlephaContext.Provider value={alepha}>{element}</AlephaContext.Provider>,
    );
  };

  it("should provide translation function", async ({ expect }) => {
    const TranslationComponent = () => {
      const { tr } = useI18n();
      return <div data-testid="greeting">{tr("hello")}</div>;
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello, World!" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <TranslationComponent />);

    expect(ui.getByTestId("greeting").textContent).toBe("Hello, World!");
  });

  it("should support type-safe translation keys", async ({ expect }) => {
    const TypeSafeComponent = () => {
      const { tr } = useI18n<App, "en">();
      return (
        <div>
          <div data-testid="hello">{tr("hello")}</div>
          <div data-testid="goodbye">{tr("goodbye")}</div>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({
          default: {
            hello: "Hello",
            goodbye: "Goodbye",
          },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <TypeSafeComponent />);

    expect(ui.getByTestId("hello").textContent).toBe("Hello");
    expect(ui.getByTestId("goodbye").textContent).toBe("Goodbye");
  });

  it("should react to language changes", async ({ expect }) => {
    const LanguageSwitcher = () => {
      const i18n = useI18n();

      return (
        <div>
          <div data-testid="message">{i18n.tr("welcome")}</div>
          <button
            type="button"
            data-testid="switch-fr"
            onClick={() => i18n.setLang("fr")}
          >
            French
          </button>
          <button
            type="button"
            data-testid="switch-es"
            onClick={() => i18n.setLang("es")}
          >
            Spanish
          </button>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: { welcome: "Welcome" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { welcome: "Bienvenue" } }),
      });

      es = $dictionary({
        lazy: async () => ({ default: { welcome: "Bienvenido" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <LanguageSwitcher />);

    // Initial state - English
    expect(ui.getByTestId("message").textContent).toBe("Welcome");

    // Switch to French
    fireEvent.click(ui.getByTestId("switch-fr"));
    await waitFor(() =>
      expect(ui.getByTestId("message").textContent).toBe("Bienvenue"),
    );

    // Switch to Spanish
    fireEvent.click(ui.getByTestId("switch-es"));
    await waitFor(() =>
      expect(ui.getByTestId("message").textContent).toBe("Bienvenido"),
    );
  });

  it("should provide current language", async ({ expect }) => {
    const LanguageDisplay = () => {
      const i18n = useI18n();
      return (
        <div>
          <div data-testid="current-lang">{i18n.lang}</div>
          <button
            type="button"
            data-testid="change-lang"
            onClick={() => i18n.setLang("de")}
          >
            Change
          </button>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: {} }),
      });

      de = $dictionary({
        lazy: async () => ({ default: {} }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <LanguageDisplay />);

    expect(ui.getByTestId("current-lang").textContent).toBe("en");

    fireEvent.click(ui.getByTestId("change-lang"));
    await waitFor(() =>
      expect(ui.getByTestId("current-lang").textContent).toBe("de"),
    );
  });

  it("should provide available languages", async ({ expect }) => {
    const LanguageList = () => {
      const i18n = useI18n();
      return (
        <div>
          <div data-testid="languages">{i18n.languages.join(", ")}</div>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: {} }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: {} }),
      });

      de = $dictionary({
        lazy: async () => ({ default: {} }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <LanguageList />);

    const text = ui.getByTestId("languages").textContent;
    expect(text).toContain("en");
    expect(text).toContain("fr");
    expect(text).toContain("de");
  });

  it("should support interpolation with args", async ({ expect }) => {
    const InterpolationComponent = () => {
      const { tr } = useI18n();
      return (
        <div>
          <div data-testid="message">
            {tr("greeting", { args: ["Alice", "developer"] })}
          </div>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({
          default: { greeting: "Hello $1, you are a $2!" },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <InterpolationComponent />);

    expect(ui.getByTestId("message").textContent).toBe(
      "Hello Alice, you are a developer!",
    );
  });

  it("should support default option", async ({ expect }) => {
    const DefaultComponent = () => {
      const { tr } = useI18n();
      return (
        <div>
          <div data-testid="existing">{tr("exists")}</div>
          <div data-testid="missing">
            {tr("missing", { default: "Default Message" })}
          </div>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: { exists: "This exists" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <DefaultComponent />);

    expect(ui.getByTestId("existing").textContent).toBe("This exists");
    expect(ui.getByTestId("missing").textContent).toBe("Default Message");
  });

  it("should provide number formatter", async ({ expect }) => {
    const NumberFormatComponent = () => {
      const i18n = useI18n();
      return (
        <div>
          <div data-testid="number">{i18n.numberFormat.format(1234567.89)}</div>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: {} }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <NumberFormatComponent />);

    expect(ui.getByTestId("number").textContent).toBe("1,234,567.89");
  });

  it("should handle multiple language switches", async ({ expect }) => {
    const MultiSwitchComponent = () => {
      const i18n = useI18n();
      return (
        <div>
          <div data-testid="text">{i18n.tr("status")}</div>
          <button
            type="button"
            data-testid="en"
            onClick={() => i18n.setLang("en")}
          >
            EN
          </button>
          <button
            type="button"
            data-testid="fr"
            onClick={() => i18n.setLang("fr")}
          >
            FR
          </button>
          <button
            type="button"
            data-testid="de"
            onClick={() => i18n.setLang("de")}
          >
            DE
          </button>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: { status: "Active" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { status: "Actif" } }),
      });

      de = $dictionary({
        lazy: async () => ({ default: { status: "Aktiv" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <MultiSwitchComponent />);

    expect(ui.getByTestId("text").textContent).toBe("Active");

    fireEvent.click(ui.getByTestId("fr"));
    await waitFor(() =>
      expect(ui.getByTestId("text").textContent).toBe("Actif"),
    );

    fireEvent.click(ui.getByTestId("de"));
    await waitFor(() =>
      expect(ui.getByTestId("text").textContent).toBe("Aktiv"),
    );

    fireEvent.click(ui.getByTestId("en"));
    await waitFor(() =>
      expect(ui.getByTestId("text").textContent).toBe("Active"),
    );
  });

  it("should fallback to fallback language for missing keys", async ({
    expect,
  }) => {
    const FallbackComponent = () => {
      const i18n = useI18n();
      return (
        <div>
          <div data-testid="common">{i18n.tr("common")}</div>
          <div data-testid="specific">{i18n.tr("specific")}</div>
          <button
            type="button"
            data-testid="switch"
            onClick={() => i18n.setLang("fr")}
          >
            Switch
          </button>
        </div>
      );
    };

    class App {
      en = $dictionary({
        lazy: async () => ({
          default: {
            common: "Common text",
            specific: "English specific",
          },
        }),
      });

      fr = $dictionary({
        lazy: async () => ({
          default: {
            common: "Texte commun",
            // 'specific' is missing in French
          },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    await alepha.start();

    const ui = renderWithAlepha(alepha, <FallbackComponent />);

    expect(ui.getByTestId("common").textContent).toBe("Common text");
    expect(ui.getByTestId("specific").textContent).toBe("English specific");

    fireEvent.click(ui.getByTestId("switch"));
    await waitFor(() =>
      expect(ui.getByTestId("common").textContent).toBe("Texte commun"),
    );
    // Should fallback to English for 'specific'
    expect(ui.getByTestId("specific").textContent).toBe("English specific");
  });
});

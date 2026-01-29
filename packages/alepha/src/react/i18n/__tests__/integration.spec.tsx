import { Alepha } from "alepha";
import { describe, test } from "vitest";
import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

describe("I18n Integration Tests", () => {
  test("should lazy load dictionaries on server start", async ({ expect }) => {
    let enLoaded = false;
    let frLoaded = false;

    class App {
      en = $dictionary({
        lazy: async () => {
          enLoaded = true;
          return { default: { hello: "Hello" } };
        },
      });

      fr = $dictionary({
        lazy: async () => {
          frLoaded = true;
          return { default: { hello: "Bonjour" } };
        },
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);

    expect(enLoaded).toBe(false);
    expect(frLoaded).toBe(false);

    await alepha.start();

    expect(enLoaded).toBe(true);
    expect(frLoaded).toBe(true);
  });

  test("should share I18nProvider instance across application", async ({
    expect,
  }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { key: "value" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);

    const i18n1 = alepha.inject(I18nProvider);
    const i18n2 = alepha.inject(I18nProvider);

    expect(i18n1).toBe(i18n2);
    expect(i18n1.registry).toBe(i18n2.registry);
  });

  test("should support multiple dictionary registrations", async ({
    expect,
  }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: {
            "app.title": "My Application",
            "app.subtitle": "Built with Alepha",
            "auth.login": "Log In",
            "auth.logout": "Log Out",
          },
        }),
      });

      fr = $dictionary({
        lazy: async () => ({
          default: {
            "app.title": "Mon Application",
            "app.subtitle": "Construit avec Alepha",
            "auth.login": "Se connecter",
            "auth.logout": "Se déconnecter",
          },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    // Test English
    expect(i18n.tr("app.title")).toBe("My Application");
    expect(i18n.tr("app.subtitle")).toBe("Built with Alepha");
    expect(i18n.tr("auth.login")).toBe("Log In");
    expect(i18n.tr("auth.logout")).toBe("Log Out");

    // Switch to French
    await i18n.setLang("fr");

    expect(i18n.tr("app.title")).toBe("Mon Application");
    expect(i18n.tr("app.subtitle")).toBe("Construit avec Alepha");
    expect(i18n.tr("auth.login")).toBe("Se connecter");
    expect(i18n.tr("auth.logout")).toBe("Se déconnecter");
  });

  test("should handle translation with complex interpolation across languages", async ({
    expect,
  }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: {
            notification: "$1 sent you $2 message(s) about $3",
          },
        }),
      });

      fr = $dictionary({
        lazy: async () => ({
          default: {
            notification: "$1 vous a envoyé $2 message(s) à propos de $3",
          },
        }),
      });

      es = $dictionary({
        lazy: async () => ({
          default: {
            notification: "$1 te envió $2 mensaje(s) sobre $3",
          },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    const args = ["John", "3", "your project"];

    expect(i18n.tr("notification", { args })).toBe(
      "John sent you 3 message(s) about your project",
    );

    await i18n.setLang("fr");
    expect(i18n.tr("notification", { args })).toBe(
      "John vous a envoyé 3 message(s) à propos de your project",
    );

    await i18n.setLang("es");
    expect(i18n.tr("notification", { args })).toBe(
      "John te envió 3 mensaje(s) sobre your project",
    );
  });

  test("should properly cleanup on stop", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { test: "Test" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();
    expect(i18n.registry[0].translations).toEqual({ test: "Test" });

    await alepha.stop();
    // Registry should still exist after stop
    expect(i18n.registry).toBeDefined();
  });

  test("should work with empty language fallback chain", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { only_en: "Only in English" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { only_fr: "Seulement en français" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    // In English, can't find French-only key
    expect(i18n.tr("only_fr")).toBe("only_fr");
    expect(i18n.tr("only_en")).toBe("Only in English");

    // In French, falls back to English for English-only key
    await i18n.setLang("fr");
    expect(i18n.tr("only_fr")).toBe("Seulement en français");
    expect(i18n.tr("only_en")).toBe("Only in English");
  });

  test("should handle rapid language switches", async ({ expect }) => {
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
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    // Rapidly switch languages
    await i18n.setLang("fr");
    expect(i18n.tr("status")).toBe("Actif");

    await i18n.setLang("de");
    expect(i18n.tr("status")).toBe("Aktiv");

    await i18n.setLang("en");
    expect(i18n.tr("status")).toBe("Active");

    await i18n.setLang("fr");
    expect(i18n.tr("status")).toBe("Actif");
  });
});

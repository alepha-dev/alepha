import { Alepha } from "alepha";
import { describe, test } from "vitest";
import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

describe("I18nProvider", () => {
  test("should register dictionaries on initialization", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { hello: "Bonjour" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    expect(i18n.registry).toHaveLength(2);
    expect(i18n.registry[0].lang).toBe("en");
    expect(i18n.registry[1].lang).toBe("fr");
  });

  test("should load all translations on server start", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello", world: "World" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { hello: "Bonjour", world: "Monde" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.registry[0].translations).toEqual({
      hello: "Hello",
      world: "World",
    });
    expect(i18n.registry[1].translations).toEqual({
      hello: "Bonjour",
      world: "Monde",
    });
  });

  test("should default to fallback language", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    expect(i18n.lang).toBe("en");
  });

  test("should translate keys in current language", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { greeting: "Hello, World!" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { greeting: "Bonjour, Monde!" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("greeting")).toBe("Hello, World!");

    await i18n.setLang("fr");
    expect(i18n.tr("greeting")).toBe("Bonjour, Monde!");
  });

  test("should fallback to fallback language when key missing", async ({
    expect,
  }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: { hello: "Hello", world: "World" },
        }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { hello: "Bonjour" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();
    await i18n.setLang("fr");

    expect(i18n.tr("hello")).toBe("Bonjour");
    expect(i18n.tr("world")).toBe("World"); // Falls back to English
  });

  test("should return key when translation not found", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("missing.key")).toBe("missing.key");
  });

  test("should support default option when key missing", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("missing", { default: "Default Text" })).toBe(
      "Default Text",
    );
  });

  test("should support variable interpolation", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: { greeting: "Hello, $1! You have $2 messages." },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("greeting", { args: ["John", "5"] })).toBe(
      "Hello, John! You have 5 messages.",
    );
  });

  test("should list all available languages", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { hello: "Bonjour" } }),
      });

      de = $dictionary({
        lazy: async () => ({ default: { hello: "Hallo" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    const languages = i18n.languages;
    expect(languages).toContain("en");
    expect(languages).toContain("fr");
    expect(languages).toContain("de");
    expect(languages).toHaveLength(3);
  });

  test("should support custom language codes", async ({ expect }) => {
    class App {
      enUS = $dictionary({
        lang: "en-US",
        lazy: async () => ({ default: { color: "color" } }),
      });

      enGB = $dictionary({
        lang: "en-GB",
        lazy: async () => ({ default: { color: "colour" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.registry[0].lang).toBe("en-US");
    expect(i18n.registry[1].lang).toBe("en-GB");
  });

  test("should support custom dictionary names", async ({ expect }) => {
    class App {
      english = $dictionary({
        name: "custom-en",
        lang: "en",
        lazy: async () => ({ default: { hello: "Hello" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    expect(i18n.registry[0].name).toBe("custom-en");
  });

  test("should update state when language changes", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { hello: "Bonjour" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    // State is set lazily, so we should set a language first
    await i18n.setLang("en");
    expect(alepha.store.get("alepha.react.i18n.lang")).toBe("en");

    await i18n.setLang("fr");
    expect(alepha.store.get("alepha.react.i18n.lang")).toBe("fr");
  });

  test("should have number formatter for current language", async ({
    expect,
  }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: {} }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.numberFormat).toBeDefined();
    expect(i18n.numberFormat.format).toBeTypeOf("function");
  });

  test("should handle multiple translations with same key across dictionaries", async ({
    expect,
  }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: {
            app: "Application",
            settings: "Settings",
          },
        }),
      });

      fr = $dictionary({
        lazy: async () => ({
          default: {
            app: "Programme",
            settings: "Paramètres",
          },
        }),
      });

      es = $dictionary({
        lazy: async () => ({
          default: {
            app: "Aplicación",
            settings: "Configuración",
          },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("app")).toBe("Application");
    expect(i18n.tr("settings")).toBe("Settings");

    await i18n.setLang("fr");
    expect(i18n.tr("app")).toBe("Programme");
    expect(i18n.tr("settings")).toBe("Paramètres");

    await i18n.setLang("es");
    expect(i18n.tr("app")).toBe("Aplicación");
    expect(i18n.tr("settings")).toBe("Configuración");
  });

  test("should handle empty dictionaries", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: {} }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("anything")).toBe("anything");
  });

  test("should handle complex interpolation patterns", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: {
            complex: "User $1 has $2 followers and follows $3 people",
          },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("complex", { args: ["Alice", "1000", "500"] })).toBe(
      "User Alice has 1000 followers and follows 500 people",
    );
  });

  describe("when only non-English dictionaries are registered", () => {
    test("should default to the first registered language", async ({
      expect,
    }) => {
      class App {
        fr = $dictionary({
          lazy: async () => ({ default: { hello: "Bonjour" } }),
        });
      }

      const alepha = Alepha.create().with(AlephaReactI18n);
      const app = alepha.inject(App);
      const i18n = alepha.inject(I18nProvider);

      expect(i18n.lang).toBe("fr");
    });

    test("should translate using the first registered language", async ({
      expect,
    }) => {
      class App {
        fr = $dictionary({
          lazy: async () => ({
            default: { greeting: "Bonjour!", settings: "Paramètres" },
          }),
        });
      }

      const alepha = Alepha.create().with(AlephaReactI18n);
      const app = alepha.inject(App);
      const i18n = alepha.inject(I18nProvider);

      await alepha.start();

      expect(i18n.tr("greeting")).toBe("Bonjour!");
      expect(i18n.tr("settings")).toBe("Paramètres");
    });

    test("should not include 'en' in languages list", async ({ expect }) => {
      class App {
        fr = $dictionary({
          lazy: async () => ({ default: { hello: "Bonjour" } }),
        });

        de = $dictionary({
          lazy: async () => ({ default: { hello: "Hallo" } }),
        });
      }

      const alepha = Alepha.create().with(AlephaReactI18n);
      const app = alepha.inject(App);
      const i18n = alepha.inject(I18nProvider);

      expect(i18n.languages).toEqual(["fr", "de"]);
    });

    test("should fallback to the first registered language for missing keys", async ({
      expect,
    }) => {
      class App {
        fr = $dictionary({
          lazy: async () => ({
            default: { hello: "Bonjour", world: "Monde" },
          }),
        });

        de = $dictionary({
          lazy: async () => ({ default: { hello: "Hallo" } }),
        });
      }

      const alepha = Alepha.create().with(AlephaReactI18n);
      const app = alepha.inject(App);
      const i18n = alepha.inject(I18nProvider);

      await alepha.start();
      await i18n.setLang("de");

      expect(i18n.tr("hello")).toBe("Hallo");
      expect(i18n.tr("world")).toBe("Monde"); // Falls back to FR
    });
  });

  test("should handle partial interpolation args", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: { message: "Hello $1, you have $2 messages and $3 alerts" },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    const app = alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    // Provide fewer args than placeholders
    expect(i18n.tr("message", { args: ["Bob"] })).toBe(
      "Hello Bob, you have $2 messages and $3 alerts",
    );
  });
});

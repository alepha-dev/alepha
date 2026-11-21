import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaReactI18n } from "../index.ts";
import { $dictionary } from "../primitives/$dictionary.ts";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * Reads whether the lazily-built `Intl` formatters exist yet, which is the
 * only way to assert from outside that construction built neither, and
 * exposes the protected request resolution.
 */
class TestI18nProvider extends I18nProvider<object, never> {
  public get builtFormatters() {
    return {
      date: this.dateFormats.size > 0,
      number: this.numberFormats.size > 0,
    };
  }

  public testResolveRequestLang = this.resolveRequestLang.bind(this);
}

describe("I18nProvider", () => {
  it("should register dictionaries on initialization", async ({ expect }) => {
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
    const i18n = alepha.inject(I18nProvider);

    expect(i18n.registry).toHaveLength(2);
    expect(i18n.registry[0].lang).toBe("en");
    expect(i18n.registry[1].lang).toBe("fr");
  });

  it("should load all translations on server start", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello", world: "World" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { hello: "Bonjour", world: "Monde" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
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

  it("should default to fallback language", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    expect(i18n.lang).toBe("en");
  });

  it("should translate keys in current language", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { greeting: "Hello, World!" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { greeting: "Bonjour, Monde!" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("greeting")).toBe("Hello, World!");

    await i18n.setLang("fr");
    expect(i18n.tr("greeting")).toBe("Bonjour, Monde!");
  });

  it("should fallback to fallback language when key missing", async ({
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
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();
    await i18n.setLang("fr");

    expect(i18n.tr("hello")).toBe("Bonjour");
    expect(i18n.tr("world")).toBe("World"); // Falls back to English
  });

  it("should return key when translation not found", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("missing.key")).toBe("missing.key");
  });

  it("should support default option when key missing", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("missing", { default: "Default Text" })).toBe(
      "Default Text",
    );
  });

  it("should support variable interpolation", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: { greeting: "Hello, $1! You have $2 messages." },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("greeting", { args: ["John", "5"] })).toBe(
      "Hello, John! You have 5 messages.",
    );
  });

  it("should list all available languages", async ({ expect }) => {
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
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    const languages = i18n.languages;
    expect(languages).toContain("en");
    expect(languages).toContain("fr");
    expect(languages).toContain("de");
    expect(languages).toHaveLength(3);
  });

  it("should support custom language codes", async ({ expect }) => {
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
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.registry[0].lang).toBe("en-US");
    expect(i18n.registry[1].lang).toBe("en-GB");
  });

  it("should support custom dictionary names", async ({ expect }) => {
    class App {
      english = $dictionary({
        name: "custom-en",
        lang: "en",
        lazy: async () => ({ default: { hello: "Hello" } }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    expect(i18n.registry[0].name).toBe("custom-en");
  });

  it("should update state when language changes", async ({ expect }) => {
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
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    // State is set lazily, so we should set a language first
    await i18n.setLang("en");
    expect(alepha.store.get("alepha.react.i18n.lang")).toBe("en");

    await i18n.setLang("fr");
    expect(alepha.store.get("alepha.react.i18n.lang")).toBe("fr");
  });

  it("should have a number formatter for the current language", async ({
    expect,
  }) => {
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
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.numberFormat.format(1234.5)).toBe("1,234.5");
    await i18n.setLang("de");
    expect(i18n.numberFormat.format(1234.5)).toBe("1.234,5");
  });

  it("should not build an Intl formatter until one is read", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaReactI18n);
    const i18n = alepha.inject(TestI18nProvider);

    // The whole point: constructing the provider costs no ICU. The first
    // `Intl.DateTimeFormat` of a process is ~8 ms and the first
    // `Intl.NumberFormat` ~1.5 ms, which was 19% of all service construction
    // on a cold Worker isolate, paid by requests that format nothing.
    expect(i18n.builtFormatters).toEqual({ date: false, number: false });

    i18n.dateFormat.format(new Date());

    expect(i18n.builtFormatters).toEqual({ date: true, number: false });
  });

  it("should cache the formatters and rebuild them on a language switch", async ({
    expect,
  }) => {
    class App {
      en = $dictionary({ lazy: async () => ({ default: {} }) });
      fr = $dictionary({ lang: "fr", lazy: async () => ({ default: {} }) });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();
    await i18n.setLang("en");

    // Cached: the formatters are built on first read, and building an
    // `Intl.DateTimeFormat` per call would put the ~8 ms ICU cost back on a
    // path that reads it repeatedly.
    expect(i18n.dateFormat).toBe(i18n.dateFormat);
    expect(i18n.numberFormat).toBe(i18n.numberFormat);

    const date = i18n.dateFormat;
    const number = i18n.numberFormat;

    // One per language: without this the app keeps formatting in the
    // language it booted in, silently.
    await i18n.setLang("fr");

    expect(i18n.dateFormat).not.toBe(date);
    expect(i18n.numberFormat).not.toBe(number);
    expect(i18n.dateFormat.format(new Date("2026-09-20T00:00:00Z"))).toBe(
      new Intl.DateTimeFormat("fr").format(new Date("2026-09-20T00:00:00Z")),
    );
  });

  it("should handle multiple translations with same key across dictionaries", async ({
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
    alepha.inject(App);
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

  it("should handle empty dictionaries", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({ default: {} }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("anything")).toBe("anything");
  });

  it("should handle complex interpolation patterns", async ({ expect }) => {
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
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    expect(i18n.tr("complex", { args: ["Alice", "1000", "500"] })).toBe(
      "User Alice has 1000 followers and follows 500 people",
    );
  });

  describe("when only non-English dictionaries are registered", () => {
    it("should default to the first registered language", async ({
      expect,
    }) => {
      class App {
        fr = $dictionary({
          lazy: async () => ({ default: { hello: "Bonjour" } }),
        });
      }

      const alepha = Alepha.create().with(AlephaReactI18n);
      alepha.inject(App);
      const i18n = alepha.inject(I18nProvider);

      expect(i18n.lang).toBe("fr");
    });

    it("should translate using the first registered language", async ({
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
      alepha.inject(App);
      const i18n = alepha.inject(I18nProvider);

      await alepha.start();

      expect(i18n.tr("greeting")).toBe("Bonjour!");
      expect(i18n.tr("settings")).toBe("Paramètres");
    });

    it("should not include 'en' in languages list", async ({ expect }) => {
      class App {
        fr = $dictionary({
          lazy: async () => ({ default: { hello: "Bonjour" } }),
        });

        de = $dictionary({
          lazy: async () => ({ default: { hello: "Hallo" } }),
        });
      }

      const alepha = Alepha.create().with(AlephaReactI18n);
      alepha.inject(App);
      const i18n = alepha.inject(I18nProvider);

      expect(i18n.languages).toEqual(["fr", "de"]);
    });

    it("should fallback to the first registered language for missing keys", async ({
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
      alepha.inject(App);
      const i18n = alepha.inject(I18nProvider);

      await alepha.start();
      await i18n.setLang("de");

      expect(i18n.tr("hello")).toBe("Hallo");
      expect(i18n.tr("world")).toBe("Monde"); // Falls back to FR
    });
  });

  describe("server-side language autodetect (Accept-Language)", () => {
    /**
     * Injects a real, dictionary-populated `I18nProvider` and exposes the
     * protected resolution used by the `server:request:before` hook, so the priority
     * (cookie → header → fallback) can be unit-tested against a true registry.
     */
    const setup = (AppClass: new () => unknown) => {
      const alepha = Alepha.create()
        .with({ provide: I18nProvider, use: TestI18nProvider })
        .with(AlephaReactI18n);
      alepha.inject(AppClass as any);
      const i18n = alepha.inject(TestI18nProvider);
      return {
        i18n,
        resolve: (cookieLang?: string, headerLang?: string): string =>
          i18n.testResolveRequestLang(cookieLang, headerLang),
      };
    };

    class App {
      en = $dictionary({
        lazy: async () => ({ default: { hello: "Hello" } }),
      });

      fr = $dictionary({
        lazy: async () => ({ default: { hello: "Bonjour" } }),
      });
    }

    it("uses the Accept-Language header when no cookie is set", ({
      expect,
    }) => {
      expect(setup(App).resolve(undefined, "fr")).toBe("fr");
    });

    it("lets a manually-selected cookie win over the header", ({ expect }) => {
      expect(setup(App).resolve("en", "fr")).toBe("en");
    });

    it("falls back when the header language is not registered", ({
      expect,
    }) => {
      expect(setup(App).resolve(undefined, "de")).toBe("en");
    });

    it("falls back when neither cookie nor header is present", ({ expect }) => {
      expect(setup(App).resolve(undefined, undefined)).toBe("en");
    });

    it("normalizes a region-qualified header to a registered base language", ({
      expect,
    }) => {
      expect(setup(App).resolve(undefined, "fr-FR")).toBe("fr");
    });

    it("prefers an exact region match when one is registered", ({ expect }) => {
      class RegionApp {
        enUS = $dictionary({
          lang: "en-US",
          lazy: async () => ({ default: { color: "color" } }),
        });

        fr = $dictionary({
          lazy: async () => ({ default: { color: "couleur" } }),
        });
      }

      expect(setup(RegionApp).resolve(undefined, "en-US")).toBe("en-US");
    });

    it("ignores the header when autoDetect is disabled", ({ expect }) => {
      const { i18n, resolve } = setup(App);
      i18n.options.autoDetect = false;
      expect(resolve(undefined, "fr")).toBe("en");
    });

    it("still honours a manual cookie when autoDetect is disabled", ({
      expect,
    }) => {
      const { i18n, resolve } = setup(App);
      i18n.options.autoDetect = false;
      expect(resolve("fr", "en")).toBe("fr");
    });
  });

  it("should handle partial interpolation args", async ({ expect }) => {
    class App {
      en = $dictionary({
        lazy: async () => ({
          default: { message: "Hello $1, you have $2 messages and $3 alerts" },
        }),
      });
    }

    const alepha = Alepha.create().with(AlephaReactI18n);
    alepha.inject(App);
    const i18n = alepha.inject(I18nProvider);

    await alepha.start();

    // Provide fewer args than placeholders
    expect(i18n.tr("message", { args: ["Bob"] })).toBe(
      "Hello Bob, you have $2 messages and $3 alerts",
    );
  });
});

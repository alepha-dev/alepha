import {
  $hook,
  $inject,
  Alepha,
  SchemaValidationError,
  TypeProvider,
  z,
} from "alepha";
import { type DateTime, DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
// Locale-prefix routing is optional: the router module (one-directional
// dependency, `i18n → router`) is only consulted when it is also registered.
import { RouterLocaleProvider } from "alepha/react/router";
import { $cookie } from "alepha/server/cookies";
import type { ServiceDictionary } from "../hooks/useI18n.ts";

export class I18nProvider<
  S extends object,
  K extends keyof ServiceDictionary<S>,
> {
  protected log = $logger();
  protected alepha = $inject(Alepha);
  protected dateTimeProvider = $inject(DateTimeProvider);

  protected cookie = $cookie({
    name: "lang",
    schema: z.text(),
    ttl: [1, "year"],
  });

  public readonly registry: Array<{
    target: string;
    name: string;
    lang: string;
    loader: () => Promise<Record<string, string>>;
    translations: Record<string, string>;

    /**
     * Whether {@link loader} has already run for this entry.
     *
     * Deliberately NOT derived from `Object.keys(translations).length` — a
     * dictionary that legitimately resolves to `{}` (an empty or
     * not-yet-populated catalog) would then read as "never loaded" forever,
     * re-invoking the loader on every single switch to that language.
     */
    loaded?: boolean;
  }> = [];

  options: {
    fallbackLang: string;
    autoDetect: boolean;
    routing: "none" | "prefix";
  } = {
    fallbackLang: "en",
    /**
     * When true (the default), the UI language for a first-time visitor (one
     * with no `lang` cookie) is detected server-side from the `Accept-Language`
     * header. A manually-selected language (the cookie) always takes
     * precedence, so this never overrides an explicit user choice. Set to false
     * to always start in `fallbackLang` regardless of the browser's preferred
     * language.
     */
    autoDetect: true,
    /**
     * URL strategy for languages:
     * - `"none"` (default): language lives in a cookie; URLs are not localized.
     * - `"prefix"`: each non-default language gets a path prefix (`/fr/about`),
     *   making every language a distinct, crawlable URL for SEO. The default
     *   language (`fallbackLang`) stays unprefixed. Requires the router module.
     *   The URL becomes the source of truth for language (it wins over the
     *   cookie / `Accept-Language`), and there is no automatic redirect.
     */
    routing: "none",
  };

  /**
   * Lazily-resolved locale-prefix router integration. Present only when both
   * the router module is registered AND `routing: "prefix"` was configured —
   * otherwise i18n stays fully standalone.
   */
  protected localeProviderResolved = false;
  protected localeProviderRef?: RouterLocaleProvider;
  protected get localeProvider(): RouterLocaleProvider | undefined {
    if (!this.localeProviderResolved) {
      this.localeProviderResolved = true;
      if (this.alepha.has(RouterLocaleProvider)) {
        this.localeProviderRef = this.alepha.inject(RouterLocaleProvider);
      }
    }
    return this.localeProviderRef;
  }

  public dateFormat: { format: (value: Date) => string } =
    new Intl.DateTimeFormat(this.lang);

  public numberFormat: { format: (value: number) => string } =
    new Intl.NumberFormat(this.lang);

  public get languages() {
    const languages = new Set<string>();

    for (const item of this.registry) {
      languages.add(item.lang);
    }

    return Array.from(languages);
  }

  constructor() {
    this.refreshLocale();
  }

  /**
   * Configure locale-prefix routing on the router, before the SSR routes are
   * registered (`priority: "first"` runs ahead of the router's own `configure`
   * hook). No-op unless `routing: "prefix"` and the router module is present.
   */
  protected readonly onConfigure = $hook({
    on: "configure",
    priority: "first",
    handler: () => {
      const localeProvider = this.localeProvider;
      if (this.options.routing === "prefix" && localeProvider) {
        localeProvider.configure({
          enabled: true,
          defaultLocale: this.fallbackLang,
          locales: this.languages,
        });
      }
    },
  });

  protected readonly onRender = $hook({
    on: "server:onRequest",
    priority: "last",
    handler: async ({ request }) => {
      this.alepha.store.set(
        "alepha.react.i18n.lang",
        this.resolveRequestLang(
          this.cookie.get(request),
          request.language,
          this.detectUrlLocale(request.url?.pathname),
        ),
      );
    },
  });

  /**
   * Detects the language carried by the request URL when `routing: "prefix"` is
   * active. Returns the locale for any URL (the prefixed one for `/fr/...`, the
   * default for an unprefixed path), or `undefined` when prefix routing is off.
   */
  protected detectUrlLocale(pathname: string | undefined): string | undefined {
    const localeProvider = this.localeProvider;
    if (localeProvider?.enabled && pathname) {
      return localeProvider.detect(pathname).locale || undefined;
    }
    return undefined;
  }

  /**
   * Resolves the UI language for an incoming server request.
   *
   * Priority:
   * 0. the URL locale prefix (`routing: "prefix"`) — the URL is the source of
   *    truth and wins over everything, with no redirect;
   * 1. the `lang` cookie — a language the user manually selected;
   * 2. the `Accept-Language` header (when `autoDetect` is enabled) — but only
   *    when the detected language is actually registered, so we never switch to
   *    a locale we have no dictionary for. A region-qualified header (`en-US`)
   *    matches an exact registration first, then its base language (`en`);
   * 3. `fallbackLang`.
   */
  protected resolveRequestLang(
    cookieLang: string | undefined,
    headerLang: string | undefined,
    urlLocale?: string,
  ): string {
    if (urlLocale) {
      return urlLocale;
    }

    if (cookieLang) {
      return cookieLang;
    }

    if (this.options.autoDetect && headerLang) {
      const registered = this.languages;
      for (const candidate of [headerLang, headerLang.split("-")[0]]) {
        if (registered.includes(candidate)) {
          return candidate;
        }
      }
    }

    return this.fallbackLang;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      if (this.alepha.isBrowser()) {
        // In prefix mode the URL (hydrated into the lang state by the server)
        // is the source of truth, so the cookie must not override it.
        if (!this.localeProvider?.enabled) {
          const cookieLang = this.cookie.get();
          if (cookieLang) {
            this.alepha.store.set("alepha.react.i18n.lang", cookieLang);
          }
        }

        for (const item of this.registry) {
          if (item.lang === this.lang || item.lang === this.fallbackLang) {
            this.log.trace("Loading language", {
              lang: item.lang,
              name: item.name,
              target: item.target,
            });
            item.translations = await item.loader();
            item.loaded = true;
          }
        }
        return;
      }

      for (const item of this.registry) {
        item.translations = await item.loader();
        item.loaded = true;
      }
    },
  });

  protected refreshLocale() {
    this.numberFormat = new Intl.NumberFormat(this.lang);
    this.dateFormat = new Intl.DateTimeFormat(this.lang);
    this.dateTimeProvider.setLocale(this.lang);
    TypeProvider.setLocale(this.lang);
  }

  /**
   * Activates a language: lazily loads its dictionaries (browser), updates the
   * lang state, and refreshes the locale-bound formatters. Does NOT persist a
   * cookie or navigate — that is the caller's concern.
   */
  protected applyLang = async (lang: string) => {
    if (this.alepha.isBrowser()) {
      for (const item of this.registry) {
        if (lang === item.lang && !item.loaded) {
          item.translations = await item.loader();
          item.loaded = true;
        }
      }
    }

    this.alepha.store.set("alepha.react.i18n.lang", lang);
    this.refreshLocale();
  };

  public setLang = async (lang: string) => {
    const localeProvider = this.localeProvider;
    if (localeProvider?.enabled) {
      // The URL is the source of truth: switching language means navigating to
      // the same page under the new locale prefix. Dictionaries and formatters
      // are then activated via the resulting `alepha.react.router.locale`
      // change (see the `mutate` hook). No cookie is written in prefix mode.
      const { ReactRouter } = await import("alepha/react/router");
      const router = this.alepha.inject(ReactRouter);
      const canonical = localeProvider.detect(router.pathname).pathname;
      await router.push(localeProvider.withPrefix(canonical, lang));
      return;
    }

    await this.applyLang(lang);
    if (this.alepha.isBrowser()) {
      this.cookie.set(lang);
    }
  };

  protected readonly mutate = $hook({
    on: "state:mutate",
    handler: async ({ key, value }) => {
      // Prefix-mode navigation changed the active locale (set by the router) →
      // activate the matching language (loads dictionaries, refreshes
      // formatters, and re-renders consumers via the lang state).
      if (
        key === "alepha.react.router.locale" &&
        this.localeProvider?.enabled
      ) {
        const lang = (value as string) || this.fallbackLang;
        if (lang !== this.lang) {
          await this.applyLang(lang);
        }
        return;
      }

      if (key === "alepha.react.i18n.lang" && this.alepha.isBrowser()) {
        for (const item of this.registry) {
          if (value === item.lang && !item.loaded) {
            item.translations = await item.loader();
            item.loaded = true;
          }
        }

        this.refreshLocale();

        // No re-notify here. `EventManager.emit` awaits its handlers in
        // registration order and this provider registers during `start`, so
        // every React subscriber of the lang atom is notified *after* the
        // loader above has resolved — they already render the loaded
        // dictionary. The re-set that used to live here wrote back the same
        // lang value, which `StateManager.set` drops on its equality
        // short-circuit: it emitted nothing and was pure dead code.
        // `i18n-async-dictionary-load.browser.spec.tsx` pins the behaviour it
        // was meant to guarantee.
      }
    },
  });

  public get fallbackLang(): string {
    const configured = this.options.fallbackLang;
    const hasDict = this.registry.some((item) => item.lang === configured);
    if (hasDict) {
      return configured;
    }
    return this.registry[0]?.lang ?? configured;
  }

  public get lang(): string {
    return this.alepha.store.get("alepha.react.i18n.lang") || this.fallbackLang;
  }

  public translate = (key: string, args: string[] = []) => {
    for (const item of this.registry) {
      if (item.lang === this.lang) {
        if (item.translations[key]) {
          return this.render(item.translations[key], args); // append lang for fallback
        }
      }
    }

    for (const item of this.registry) {
      if (item.lang === this.fallbackLang) {
        if (item.translations[key]) {
          return this.render(item.translations[key], args); // append lang for fallback
        }
      }
    }

    return key; // fallback to the key itself if not found
  };

  public readonly l = (
    value: I18nLocalizeType,
    options: I18nLocalizeOptions = {},
  ) => {
    // Handle numbers
    if (typeof value === "number" && !options.date) {
      return new Intl.NumberFormat(this.lang, options.number).format(value);
    }

    // Handle dates
    if (
      value instanceof Date ||
      this.dateTimeProvider.isDateTime(value) ||
      (typeof value === "string" && options.date) ||
      (typeof value === "number" && options.date)
    ) {
      // convert to DateTime with locale applied
      let dt = this.dateTimeProvider.of(value);

      // apply timezone if specified
      if (options.timezone) {
        dt = dt.tz(options.timezone);
      }

      // format using dayjs format string
      if (typeof options.date === "string") {
        if (options.date === "fromNow") {
          return dt.locale(this.lang).fromNow();
        }
        return dt.locale(this.lang).format(options.date);
      }

      // format using Intl.DateTimeFormatOptions
      if (options.date) {
        return new Intl.DateTimeFormat(
          this.lang,
          options.timezone
            ? { ...options.date, timeZone: options.timezone }
            : options.date,
        ).format(dt.toDate());
      }

      // default formatting with timezone
      if (options.timezone) {
        return new Intl.DateTimeFormat(this.lang, {
          timeZone: options.timezone,
        }).format(dt.toDate());
      }

      // default formatting
      return new Intl.DateTimeFormat(this.lang).format(dt.toDate());
    }

    // handle Zod errors
    if (value instanceof SchemaValidationError) {
      return TypeProvider.translateError(value, this.lang);
    }

    // return string values as-is
    return value;
  };

  /**
   * Look up `key` in the registered dictionaries. The `(string & {})` arm
   * keeps autocomplete for the typed dictionary keys while allowing shared
   * library components to pass arbitrary string keys (with a `default`
   * fallback) without casting to `as never`.
   */
  public readonly tr = (
    key: keyof ServiceDictionary<S>[K] | (string & {}),
    options: {
      args?: string[];
      default?: string;
    } = {},
  ) => {
    const translation = this.translate(key as string, options.args || []);
    if (translation === (key as string) && options.default) {
      return options.default;
    }
    return translation;
  };

  /**
   * Substitute `$1`, `$2`, … placeholders with their arguments.
   *
   * One regex pass, not a loop of `String.replace(string, …)`. The loop had
   * two faults: it replaced `$1` before it ever considered `$10`, so `$10`
   * matched the `$1` pass and became `args[0] + "0"`; and a string pattern
   * replaces only the FIRST occurrence, so a placeholder used twice was
   * substituted once.
   *
   * A single pass also means a substituted VALUE is never rescanned, so a
   * user-supplied string that happens to contain `$2` is inserted literally
   * instead of being treated as another placeholder. A placeholder with no
   * corresponding argument is left as written.
   */
  protected render(item: string, args: string[]): string {
    return item.replace(/\$(\d+)/g, (match, digits: string) => {
      const index = Number.parseInt(digits, 10) - 1;
      return index >= 0 && index < args.length ? String(args[index]) : match;
    });
  }
}

export type I18nLocalizeType =
  | string
  | number
  | Date
  | DateTime
  | SchemaValidationError;

export interface I18nLocalizeOptions {
  /**
   * Options for number formatting (when value is a number)
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat
   */
  number?: Intl.NumberFormatOptions;
  /**
   * Options for date formatting (when value is a Date or DateTime)
   * Can be:
   * - A dayjs format string (e.g., "LLL", "YYYY-MM-DD", "dddd, MMMM D YYYY")
   * - "fromNow" for relative time (e.g., "2 hours ago")
   * - Intl.DateTimeFormatOptions for native formatting
   * @see https://day.js.org/docs/en/display/format
   * @see https://day.js.org/docs/en/display/from-now
   */
  date?: string | "fromNow" | Intl.DateTimeFormatOptions;
  /**
   * Timezone to display dates in (when value is a Date or DateTime)
   * Uses IANA timezone names (e.g., "America/New_York", "Europe/Paris", "Asia/Tokyo")
   * @see https://day.js.org/docs/en/timezone/timezone
   */
  timezone?: string;
}

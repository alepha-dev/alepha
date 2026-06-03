import { $inject, Alepha } from "alepha";

/**
 * Generic locale path-prefix mechanism for the router.
 *
 * This provider knows nothing about i18n — it only deals with URL path
 * segments. It is configured by the i18n module (`I18nProvider`) when
 * `routing: "prefix"` is enabled, which keeps the dependency one-directional
 * (`i18n → router`) and avoids a module cycle.
 *
 * The default locale is served WITHOUT a prefix (`/about` = default,
 * `/fr/about` = French). The active locale is derived from the current
 * request/navigation and stored under `alepha.react.router.locale`, so every
 * URL the router builds (`pathname()`) automatically carries the right prefix.
 */
export class RouterLocaleProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * Whether locale path-prefixing is active. Off by default — opt-in via the
   * i18n module.
   */
  public enabled = false;

  /**
   * The default locale, served without a path prefix (e.g. `"en"` → `/about`).
   */
  public defaultLocale = "";

  /**
   * All known locales, including the default one.
   */
  public locales: string[] = [];

  /**
   * Configure the provider. Called by the i18n module before the SSR routes
   * are registered.
   */
  public configure(options: {
    enabled?: boolean;
    defaultLocale?: string;
    locales?: string[];
  }): void {
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    if (options.defaultLocale !== undefined) {
      this.defaultLocale = options.defaultLocale;
    }
    if (options.locales !== undefined) {
      this.locales = options.locales;
    }
  }

  /**
   * Locales that carry a URL prefix — every known locale except the default.
   */
  public get prefixedLocales(): string[] {
    return this.locales.filter((locale) => locale !== this.defaultLocale);
  }

  /**
   * Splits a leading locale segment off a pathname.
   *
   * - `/fr/about` → `{ locale: "fr", pathname: "/about" }` when `fr` is a
   *   prefixed locale.
   * - `/about` → `{ locale: defaultLocale, pathname: "/about" }`.
   *
   * When prefixing is disabled the pathname is returned untouched.
   */
  public detect(pathname: string): { locale: string; pathname: string } {
    if (this.enabled) {
      const first = pathname.split("/")[1];
      if (first && this.prefixedLocales.includes(first)) {
        const rest = pathname.slice(first.length + 1);
        return { locale: first, pathname: this.normalize(rest) };
      }
    }
    return { locale: this.defaultLocale, pathname };
  }

  /**
   * Prepends the locale prefix to a pathname when needed. The default locale
   * (and any unknown/disabled case) returns the pathname unchanged.
   */
  public withPrefix(pathname: string, locale: string = this.current): string {
    if (
      !this.enabled ||
      !locale ||
      locale === this.defaultLocale ||
      !this.prefixedLocales.includes(locale)
    ) {
      return pathname;
    }
    return `/${locale}${pathname === "/" ? "" : pathname}`;
  }

  /**
   * The active locale, derived from the current request/navigation. Falls back
   * to the default locale when nothing has been detected.
   */
  public get current(): string {
    return (
      this.alepha.store.get("alepha.react.router.locale") || this.defaultLocale
    );
  }

  public set current(locale: string) {
    this.alepha.store.set("alepha.react.router.locale", locale);
  }

  /**
   * Normalizes a stripped pathname so it always starts with a single slash and
   * carries no trailing slash (except the root `/`).
   */
  protected normalize(pathname: string): string {
    if (!pathname || pathname === "/") {
      return "/";
    }
    const withLeading = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return withLeading.length > 1 && withLeading.endsWith("/")
      ? withLeading.slice(0, -1)
      : withLeading;
  }
}

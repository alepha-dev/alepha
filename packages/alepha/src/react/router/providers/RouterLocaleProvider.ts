import { $inject, Alepha } from "alepha";

/**
 * Generic locale path-prefix mechanism for the router.
 *
 * This provider knows nothing about i18n - it only deals with URL path
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
   * Path prefixes that never carry a locale prefix.
   *
   * Locale-prefixed URLs exist for crawlers: a distinct, indexable URL per
   * language. That argument covers a storefront and stops dead at the signed-in
   * surfaces — `/admin`, `/account` — which are behind a guard, never crawled,
   * and would only gain a second URL for the same private page. Worse, the
   * prefix is a *route*: `/en/admin` has to be registered, matched and kept
   * working, and every deep link into the back office acquires a language.
   *
   * Excluded subtrees keep one canonical URL and fall back to the cookie for
   * language, which is what `routing: "none"` does everywhere.
   */
  public excluded: string[] = [];

  /**
   * Configure the provider. Called by the i18n module before the SSR routes
   * are registered.
   */
  public configure(options: {
    enabled?: boolean;
    defaultLocale?: string;
    locales?: string[];
    excluded?: string[];
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
    if (options.excluded !== undefined) {
      this.excluded = options.excluded;
    }
  }

  /**
   * Whether this pathname sits in a subtree that opts out of locale prefixes.
   *
   * Matches a prefix on a segment boundary, so `/admin` covers `/admin` and
   * `/admin/pieces` but not `/administration` — the difference between an
   * exclusion and an accidental one.
   *
   * The pathname is taken unprefixed. Call it with `detect(...).pathname` when
   * the input may still carry a locale, so an existing `/en/admin` link is
   * recognised as the excluded `/admin` rather than treated as a normal page.
   */
  public isExcluded(pathname: string): boolean {
    return this.excluded.some(
      (prefix) =>
        pathname === prefix ||
        pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
    );
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
      !this.prefixedLocales.includes(locale) ||
      this.isExcluded(pathname)
    ) {
      return pathname;
    }
    return `/${locale}${pathname === "/" ? "" : pathname}`;
  }

  /**
   * Read the locale out of `pathname`, adopt it as the active one, and return
   * the canonical (unprefixed) path to match routes against.
   *
   * The one place a navigation turns a URL into "the current language", so the
   * exclusion rule lives here rather than in each router.
   *
   * **An excluded path leaves `current` untouched.** `detect` reports the
   * default locale for anything unprefixed, so adopting it would publish "the
   * URL says <default>" on every navigation into `/admin` — and the i18n
   * module listens to exactly that to pick the language. It would overwrite
   * the cookie, which inside an excluded subtree is the only thing carrying
   * the choice. The symptom is a language switch that visibly works and then
   * reverts on the next navigation or reload.
   */
  public adopt(pathname: string): string {
    const detected = this.detect(pathname);
    if (!this.isExcluded(detected.pathname)) {
      this.current = detected.locale;
    }
    return detected.pathname;
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

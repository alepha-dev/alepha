/**
 * How a server request's language is chosen, as self-contained functions.
 *
 * Self-contained on purpose: the Cloudflare worker `alepha build` generates
 * embeds their source (`Function.prototype.toString`) to resolve the language
 * of a request BEFORE the application boots, to find a cached page in
 * `caches.default` (#E78). The app resolves it with the same functions after
 * boot, so the two cannot drift. Nothing here may reach outside its own body:
 * no import, no `this`, no helper.
 */
export class RequestLangResolver {
  /**
   * The most preferred language of an `Accept-Language` header: its first tag
   * without its quality, `"en-US,en;q=0.9"` giving `"en-US"`. The same parse
   * as `ServerRequestParser.getLanguage`.
   */
  public static readonly fromHeader = (
    acceptLanguage: string | null | undefined,
  ): string | undefined => {
    if (!acceptLanguage) {
      return undefined;
    }
    const first = acceptLanguage.split(",")[0];
    if (!first) {
      return undefined;
    }
    const lang = first.split(";")[0].trim();
    return lang || undefined;
  };

  /**
   * The language of a request. Priority:
   *
   * 0. the URL locale prefix (`routing: "prefix"`): the URL is the source of
   *    truth and wins over everything, with no redirect;
   * 1. the `lang` cookie: a language the visitor chose;
   * 2. the `Accept-Language` language (when `autoDetect` is on), but only when
   *    it is registered, so a request never switches to a locale with no
   *    dictionary. A region-qualified tag (`en-US`) matches an exact
   *    registration first, then its base language (`en`);
   * 3. the fallback language.
   */
  public static readonly resolve = (input: {
    urlLocale?: string;
    cookieLang?: string;
    headerLang?: string;
    languages: string[];
    fallbackLang: string;
    autoDetect: boolean;
  }): string => {
    if (input.urlLocale) {
      return input.urlLocale;
    }
    if (input.cookieLang) {
      return input.cookieLang;
    }
    if (input.autoDetect && input.headerLang) {
      for (const candidate of [
        input.headerLang,
        input.headerLang.split("-")[0],
      ]) {
        if (input.languages.includes(candidate)) {
          return candidate;
        }
      }
    }
    return input.fallbackLang;
  };
}

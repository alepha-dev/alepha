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
   * The `Accept-Language` header as {@link resolve} takes it: the whole
   * value, `"en-US,en;q=0.9"` as sent, or `undefined` for an absent or empty
   * one. The list is negotiated in `resolve`, against the languages the app
   * declares, so its first tag alone is not the answer.
   */
  public static readonly fromHeader = (
    acceptLanguage: string | null | undefined,
  ): string | undefined => {
    return acceptLanguage?.trim() || undefined;
  };

  /**
   * The language of a request, always one the app declares (`languages`) or
   * its fallback. Every source is the client's to write, so a value that
   * names no declared language is ignored, never passed on: it would reach
   * `Intl`, `<html lang>` and the page cache's variants as given. A declared
   * language is matched whatever its case and answered as declared. Priority:
   *
   * 0. the URL locale prefix (`routing: "prefix"`): the URL is the source of
   *    truth and wins over everything, with no redirect;
   * 1. the `lang` cookie: a language the visitor chose;
   * 2. `Accept-Language` (when `autoDetect` is on): `headerLang` is the
   *    header's value, a list of language ranges with optional qualities
   *    (one bare tag is such a list). The ranges are tried by descending
   *    quality, then in the order sent, each by the lookup of RFC 4647: the
   *    range itself, then the range cut one subtag at a time (`zh-Hant-TW`,
   *    `zh-Hant`, `zh`). `*` and a range of quality 0 match nothing;
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
    const declared = (lang: string | undefined): string | undefined => {
      if (!lang) {
        return undefined;
      }
      const wanted = lang.toLowerCase();
      return input.languages.find((it) => it.toLowerCase() === wanted);
    };

    const chosen = declared(input.urlLocale) ?? declared(input.cookieLang);
    if (chosen) {
      return chosen;
    }

    if (input.autoDetect && input.headerLang) {
      const ranges = input.headerLang
        .split(",")
        .map((item, index) => {
          const [tag, ...params] = item.split(";");
          let quality = 1;
          for (const param of params) {
            const match = /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(param);
            if (match) {
              quality = Number(match[1]);
            }
          }
          return { tag: tag.trim(), quality, index };
        })
        .filter((it) => it.tag && it.tag !== "*" && it.quality > 0)
        .sort((a, b) => b.quality - a.quality || a.index - b.index);

      for (const range of ranges) {
        let tag = range.tag;
        while (tag) {
          const found = declared(tag);
          if (found) {
            return found;
          }
          const cut = tag.lastIndexOf("-");
          tag = cut < 0 ? "" : tag.slice(0, cut);
          // A single-letter subtag introduces an extension and means nothing
          // alone: it goes with what followed it (RFC 4647, section 3.4).
          if (/-[a-z0-9]$/i.test(tag)) {
            tag = tag.slice(0, -2);
          }
        }
      }
    }

    return input.fallbackLang;
  };
}

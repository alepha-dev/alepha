/**
 * The writing direction of a language, from a fixed list of right-to-left
 * languages (#Q3350).
 *
 * A fixed list and not `Intl.Locale.prototype.getTextInfo()`: the server and
 * the browser must give the same answer or hydration breaks, browser support
 * for `getTextInfo` was not established, and it throws on a tag that is not
 * one, which a request's `lang` cookie can be (it reaches the provider
 * unvalidated). The list is matched on the base language of the tag, so
 * `ar-EG` and `he_IL` are right-to-left.
 */
export class LangDirection {
  public static readonly rtl: ReadonlySet<string> = new Set([
    "ar",
    "he",
    "fa",
    "ur",
    "ps",
    "sd",
    "ug",
    "yi",
    "dv",
    "ckb",
  ]);

  /**
   * `"rtl"` for a right-to-left language, `"ltr"` for anything else,
   * including a string that is not a language tag.
   */
  public static readonly of = (lang: string | undefined): "rtl" | "ltr" => {
    const base = (lang ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
    return LangDirection.rtl.has(base) ? "rtl" : "ltr";
  };
}

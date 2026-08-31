import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

type I18nApi = ReturnType<typeof useI18n<I18n, "en">>;

/**
 * Any key of the `en` catalogue. Wide on purpose: this hook only knows that
 * two keys describe the same noun, and there is no type that expresses that.
 */
export type CountLabelKey = Parameters<I18nApi["tr"]>[0];

/**
 * `1 epic` / `4 epics`, from a pair of keys.
 *
 * The rest of this catalogue writes `$1 epic(s)`, and the release view does
 * not. Its plate carries three counts on one line and its Overview cards put
 * one in a sentence a reader is meant to act on - and at that density
 * "6 quest(s) still to land" reads as a string somebody forgot to finish.
 *
 * A pair of keys is the entire mechanism available: `alepha/react/i18n` has
 * no plural rule, and adding one is a framework change rather than a copy fix.
 * It is deliberately not general - two forms is right for English and for
 * French, and wrong for languages with more.
 */
export const useCountLabel = () => {
  const { tr } = useI18n<I18n, "en">();

  return (n: number, one: CountLabelKey, many: CountLabelKey): string =>
    String(n === 1 ? tr(one) : tr(many, { args: [String(n)] }));
};

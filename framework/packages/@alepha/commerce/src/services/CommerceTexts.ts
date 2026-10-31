import { $store } from "alepha";

import { commerceDocumentsEn } from "../lib/documents-en.ts";
import { commerceDocumentsFr } from "../lib/documents-fr.ts";
import { orderConfig } from "../orderConfigAtom.ts";

/**
 * What the package writes to a customer, in the shop's language: invoices,
 * credit notes and the default emails.
 *
 * A dictionary of its own, on the server: `alepha/react/i18n` answers a browser
 * and a request, and a job issuing an invoice at night has neither. The language
 * is the shop's, `orderConfig.locale`, rather than the visitor's: a legal
 * document follows the seller's books. French and English ship; any other is an
 * {@link add} away, and whatever it leaves out reads in English.
 *
 * ```ts
 * alepha.inject(CommerceTexts).add("de", { "invoice.title": "Rechnung" });
 * ```
 */
export class CommerceTexts {
  protected readonly config = $store(orderConfig);

  protected readonly dictionaries: Record<string, Record<string, string>> = {
    en: commerceDocumentsEn,
    fr: commerceDocumentsFr,
  };

  /**
   * Add a language, or overrule a text of one that ships.
   */
  public add(locale: string, texts: Record<string, string>): void {
    this.dictionaries[locale] = { ...this.dictionaries[locale], ...texts };
  }

  /**
   * A text in the shop's language, `$1` and on replaced by `args`.
   */
  public t(key: string, ...args: string[]): string {
    const text =
      this.dictionaries[this.config.locale]?.[key] ??
      commerceDocumentsEn[key] ??
      key;
    return text.replace(
      /\$(\d)/g,
      (slot, index) => args[Number(index) - 1] ?? slot,
    );
  }
}

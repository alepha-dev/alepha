import type { DashboardCardResource } from "../../../../api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../../../../api/schemas/dashboardCardValueSchema.ts";
import type { DashboardMetricCatalog } from "../../../../api/schemas/DashboardMetricCatalog.ts";

/**
 * Assembles the computed board's opening sentence from the tiles that
 * rendered (#E77, #Q2663): "0.33.0 ships in 6 days and is 78% done, 3 things
 * need you and 12 quests were completed this week."
 *
 * A template, not a model. Each rendered tile's metric may contribute one
 * clause (`DashboardMetricDescriptor.clause`) from its resolved value, in
 * board order; a tile that is not on the board (its slot collapsed, its
 * capability is off) is not in `cards` and so says nothing, and a value that
 * failed or is empty is skipped too.
 *
 * The locale joins them, not this code: each clause is a fragment written in
 * its own language's word order, the list is joined by `Intl.ListFormat`
 * (", " and "and" in English, ", " and "et" in French, no Oxford comma
 * there), and the sentence frame (`dashboard.headline`) is the locale's.
 */
export class DashboardHeadline {
  build(
    cards: DashboardCardResource[],
    values: DashboardCardValue[] | undefined,
    catalog: DashboardMetricCatalog,
    tr: (key: never, options?: { args?: string[] }) => string,
    lang: string,
  ): string | undefined {
    if (!values) return undefined;
    const valueOf = new Map(values.map((value) => [value.cardId, value]));
    const fragments: string[] = [];
    for (const card of cards) {
      const value = valueOf.get(card.id);
      if (!value || !value.ok || value.empty) continue;
      const clause = catalog.find(card.metric)?.clause?.(value);
      if (!clause) continue;
      fragments.push(tr(clause.key as never, { args: clause.args }));
    }
    if (fragments.length === 0) return undefined;
    const list = new Intl.ListFormat(lang, {
      style: "long",
      type: "conjunction",
    }).format(fragments);
    const sentence = tr("dashboard.headline" as never, { args: [list] });
    return sentence.charAt(0).toLocaleUpperCase(lang) + sentence.slice(1);
  }
}

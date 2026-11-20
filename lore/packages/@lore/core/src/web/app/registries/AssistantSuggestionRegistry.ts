/**
 * The prompts the assistant offers on a page, keyed by route (#Q3585).
 *
 * The panel's empty state used to offer the same three prompts everywhere,
 * an epic one on Reports included, while its subtitle says "Ask anything
 * about this page". Each module registers the suggestions of its own pages
 * here, from its shell service at boot, so a new page adds its prompts where
 * it lives rather than in a switch in the panel. Core registers its own
 * (Reports) the same way.
 *
 * The open page is matched from its deepest route layer up: an app's tab
 * finds the entry for the app's layout, and a page nobody registered keeps
 * the panel's generic set.
 */
export class AssistantSuggestionRegistry {
  protected readonly entries: AssistantSuggestionEntry[] = [];

  public register(entry: AssistantSuggestionEntry): void {
    this.entries.push(entry);
  }

  /**
   * The suggestion keys for a page whose route layers are `routeNames`,
   * outermost first; `undefined` when no entry claims any of them.
   */
  public suggestionsFor(
    routeNames: string[],
  ): AssistantSuggestionKey[] | undefined {
    for (const name of routeNames.toReversed()) {
      const entry = this.entries.find((it) => it.routes(name));
      if (entry) return entry.keys;
    }
    return undefined;
  }
}

/**
 * A catalogue key the panel translates into a suggestion's label, a string
 * like every other registry's `labelKey`.
 */
export type AssistantSuggestionKey = string;

/**
 * The suggestions of one set of pages.
 */
export interface AssistantSuggestionEntry {
  /**
   * Whether a route layer, by name, belongs to these pages.
   */
  routes: (name: string) => boolean;
  /**
   * The suggestions' catalogue keys, in order. Three reads best.
   */
  keys: AssistantSuggestionKey[];
}

import { commandScore } from "./commandScore.ts";

/**
 * A group of items, in the shape Base UI's `Autocomplete` accepts: anything
 * with an `items` array. The other fields (a key, a heading) are the caller's.
 */
export interface CommandItemGroup<Item> {
  [key: string]: unknown;
  items: readonly Item[];
}

/**
 * How well an item matches the query: 0 hides it, and a higher score lists it
 * first. `itemToString` is the root's, so a filter can score the same text the
 * default one does and add to it.
 */
export type CommandFilter<Item> = (
  item: Item,
  query: string,
  itemToString: (item: Item) => string,
) => number;

/**
 * The text an item is searched by when the root is given no `itemToStringValue`:
 * a string or number item itself, or an object's `label` when it is a string.
 * Any other object has no text, so a query never matches it: pass
 * `itemToStringValue` for those.
 */
export const defaultCommandItemToString = (item: unknown): string => {
  if (typeof item === "string") return item;
  if (typeof item === "number") return String(item);
  if (item && typeof item === "object" && "label" in item) {
    const label = (item as { label?: unknown }).label;
    if (typeof label === "string") return label;
  }
  return "";
};

/**
 * cmdk's filter: a fuzzy subsequence score over the item's text.
 */
export const defaultCommandFilter = <Item>(
  item: Item,
  query: string,
  itemToString: (item: Item) => string,
): number => commandScore(itemToString(item), query);

export const isCommandItemGroups = <Item>(
  items: readonly Item[] | readonly CommandItemGroup<Item>[],
): items is readonly CommandItemGroup<Item>[] =>
  items.length > 0 &&
  items.every(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      Array.isArray((entry as { items?: unknown }).items),
  );

/**
 * The items a query leaves, best first, in the order cmdk used to draw them.
 *
 * - An empty query keeps every item, in the order given.
 * - An item scoring 0 is dropped.
 * - Items are ordered by score, highest first; a tie keeps the given order.
 * - Groups keep their items together. A group with nothing left is dropped,
 *   and the groups are ordered by their best item's score, so the row that is
 *   highlighted first is the best match in the whole list.
 */
export const rankCommandItems = <Item>(
  items: readonly Item[] | readonly CommandItemGroup<Item>[],
  query: string,
  filter: CommandFilter<Item>,
  itemToString: (item: Item) => string,
): readonly Item[] | readonly CommandItemGroup<Item>[] => {
  if (query === "") return items;

  const rank = (list: readonly Item[]) =>
    list
      .map((item, index) => ({
        item,
        index,
        score: filter(item, query, itemToString),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!isCommandItemGroups(items)) {
    return rank(items as readonly Item[]).map((entry) => entry.item);
  }

  return items
    .map((group, index) => {
      const ranked = rank(group.items);
      return {
        group: { ...group, items: ranked.map((entry) => entry.item) },
        index,
        best: ranked[0]?.score ?? 0,
      };
    })
    .filter((entry) => entry.group.items.length > 0)
    .sort((a, b) => b.best - a.best || a.index - b.index)
    .map((entry) => entry.group);
};

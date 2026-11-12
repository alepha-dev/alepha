/**
 * The token sets every showcase page is scanned in. `cvd` is not a theme: it
 * is the colour-blind vision mode, a class on `<html>` that remaps the signal
 * tokens, and it combines with `.dark`.
 */
export type A11yMode = "light" | "dark" | "light-cvd" | "dark-cvd";

/**
 * One known accessibility finding of the showcase scan (`a11y.spec.ts`).
 *
 * A finding is one (page, mode, rule, node). It is known when an entry has
 * the same `page`, `rule` and `selector` and lists that mode.
 */
export interface A11yBaselineEntry {
  /**
   * The route path, `/blocks/buttons`. For a state opened by a click, the path
   * plus the state's name as the spec names it: `/blocks/dialog#confirm`.
   */
  page: string;

  /**
   * The token sets the finding was seen in.
   */
  modes: A11yMode[];

  /**
   * The axe rule id, `color-contrast`.
   */
  rule: string;

  /**
   * axe's own selector for the node, copied from the failure message.
   *
   * A list when axe names the same node differently from one machine to
   * another (it picks the shortest selector unique on the page as it is):
   * each item is still one concrete selector, never a pattern, and the entry
   * is stale only when none of them matches.
   */
  selector: string | string[];

  /**
   * One sentence saying why it is not fixed here, and the quest that tracks
   * the fix when there is one.
   */
  reason: string;
}

/**
 * Every known finding of the showcase scan.
 *
 * ⚠️ Edited by hand only. A finding outside this list fails the run, and the
 * failure prints it in the shape of an entry: baselining it is a deliberate
 * copy with a reason written by hand. An entry, or one of its modes, that no
 * finding matches any more fails the run too, so a fix lands by deleting its
 * entry. There is no wildcard: every entry names one page, one rule and one
 * selector.
 */
export const A11Y_BASELINE: A11yBaselineEntry[] = [];

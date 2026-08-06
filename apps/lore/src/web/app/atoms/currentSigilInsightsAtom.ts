import { $atom } from "alepha";
import { insightsResourceSchema } from "@/api/schemas/insightsResourceSchema.ts";

/**
 * The open app's analytics for the range currently selected on its page.
 *
 * Seeded by the `projectApp` loader and rewritten by the layout's range toggle,
 * which is why it is an atom rather than a loader prop: the Analytics /
 * Performance / Errors tabs are children of the layout that owns the toggle,
 * and a `NestedView` child cannot receive props from the layout around it.
 *
 * `undefined` when the project has Beacon off — the tabs that read it are not
 * rendered in that case.
 */
export const currentSigilInsightsAtom = $atom({
  name: "lor.current.sigil.insights",
  schema: insightsResourceSchema.optional(),
});

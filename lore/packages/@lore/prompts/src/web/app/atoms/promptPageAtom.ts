import { pinnedPromptItemSchema } from "@lore/core/web";
import { $atom, z } from "alepha";

/**
 * The pinnable page on screen and the item it gives (#Q4284), published by
 * the page's robot button and read by the spotlight, which mounts outside
 * the page: "Copy prompt" there fills the item as the button does.
 *
 * Cleared when the page leaves. Wrapped in an object because `$atom`
 * schemas must be object or array.
 */
export const promptPageAtom = $atom({
  name: "lor.prompt.page",
  schema: z.object({
    page: z.string().optional(),
    item: pinnedPromptItemSchema.optional(),
  }),
  default: {},
});

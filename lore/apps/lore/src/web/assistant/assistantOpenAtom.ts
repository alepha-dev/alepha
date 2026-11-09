import { $atom, z } from "alepha";

/**
 * Whether the assistant's panel is open (#Q3211). An `$atom` so the header
 * button, on whichever page draws it, and the panel, mounted once at the
 * layout's root, agree.
 */
export const assistantOpenAtom = $atom({
  name: "lore.assistant.open",
  schema: z.boolean(),
  default: false,
});

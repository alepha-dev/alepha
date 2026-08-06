import { $atom } from "alepha";
import { sigilResourceSchema } from "@/api/schemas/sigilResourceSchema.ts";

/**
 * The app whose page is open — set by the `projectApp` route loader, cleared on
 * leave.
 *
 * The tab bar, the dashboard and the settings tab all need it, and they are
 * three separate router layers: `NestedView` renders a child element it was
 * handed, so a layout cannot pass props down to the tab it is rendering.
 */
export const currentSigilAtom = $atom({
  name: "lor.current.sigil",
  schema: sigilResourceSchema.optional(),
});

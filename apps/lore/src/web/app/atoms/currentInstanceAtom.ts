import { $atom } from "alepha";

import { appInstanceResourceSchema } from "@/api/schemas/appInstanceResourceSchema.ts";

/**
 * The instance whose page is open — set by the `projectApp` route loader,
 * cleared on leave.
 *
 * The tab bar, the overview and the settings tab all need it, and they are
 * three separate router layers: `NestedView` renders a child element it was
 * handed, so a layout cannot pass props down to the tab it is rendering.
 *
 * It carries the instance's unlocks with it (`sigil`, `estate`), which is what
 * lets the tab bar decide its own tab set without a second request.
 */
export const currentInstanceAtom = $atom({
  name: "lor.current.instance",
  schema: appInstanceResourceSchema.optional(),
});

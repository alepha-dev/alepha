import { $atom } from "alepha";

import { ownedHostResourceSchema } from "../../../api/schemas/ownedHostResourceSchema.ts";

/**
 * The host whose console is open, set by the `/:projectSlug/hosts/:hostSlug` loader and
 * cleared on the way out.
 *
 * An atom rather than loader props because the shell renders the header and
 * the nav while every tab under it needs the same row: the layout is one
 * layer above the routed content, exactly as `currentInstanceAtom` sits above
 * an app's tabs.
 *
 * The OWNED shape, because the Settings tab detaches the loans it carries and
 * the route is owner-gated anyway.
 */
export const currentHostAtom = $atom({
  name: "lor.bay.host",
  schema: ownedHostResourceSchema.optional(),
});

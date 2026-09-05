import { $module } from "alepha";
import { AlephaServerLinks } from "alepha/server/links";

import { ShowcaseController } from "./ShowcaseController.ts";
import { ShowcaseMembers } from "./ShowcaseMembers.ts";

/**
 * The data half of the showcase.
 *
 * `AlephaServerLinks` is imported explicitly rather than assumed: it serves
 * `GET /api/_links` and `POST /api/_batch`, which is how the browser resolves
 * and dispatches every action on this site.
 */
export const UiShowcase = $module({
  name: "ui.showcase",
  imports: [AlephaServerLinks],
  services: [ShowcaseMembers, ShowcaseController],
});

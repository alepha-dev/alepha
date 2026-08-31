import { type Infer, z } from "alepha";

import { projectResourceSchema } from "./projectResourceSchema.ts";
import { roadmapReleaseSchema } from "./roadmapReleaseSchema.ts";

/**
 * Everything a roadmap page is allowed to know.
 *
 * ⚠️ **This is the narrowest response schema in the application and the only
 * one an anonymous caller can reach.** `schema.response` is what serializes,
 * so this object - not the component, not the query - is what decides whether
 * something reaches the internet. `test/roadmap-public-endpoint.spec.ts` pins
 * its exact key set and fails when a key is added, because the failure mode
 * this guards against is a field somebody adds to an entity six months from
 * now and that rides along silently.
 *
 * Folio #1073 states the governing constraint: a public page must be a
 * separate, narrow, opt-in surface with its own response schema, never a
 * relaxation of the membership gate. The deprecated `projects.public` column
 * is a warning, not a template.
 *
 * No user ids, no member names, no quest titles, no `createdBy`, no
 * timestamps beyond `targetDate` and `releasedAt`.
 *
 * ## Why `project.title` is here, when nothing else about the project is
 *
 * The enumerated contract for this endpoint is releases and epics. The title
 * is the one addition, and it is deliberate: the page is server-rendered for
 * a crawler and for a stakeholder who does not use Lore, and neither can read
 * a roadmap that does not say whose it is. It is also already in the URL in
 * folded form - the slug is derived from the title by `ProjectSlugService` -
 * so this discloses the capitalisation and the accents, not the name.
 *
 * Picked off `projectResourceSchema`, so it is one field and cannot grow into
 * "the project" by accident.
 */
export const roadmapResourceSchema = z.object({
  project: projectResourceSchema.pick({ title: true }),
  /**
   * Open releases first, in `number` order, then the released ones. The ORDER
   * is the server's answer rather than a sort key the client re-derives.
   */
  releases: z.array(roadmapReleaseSchema),
});

export type RoadmapResource = Infer<typeof roadmapResourceSchema>;

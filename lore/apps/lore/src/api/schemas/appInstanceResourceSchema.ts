import type { Infer } from "alepha";

import { appInstances } from "../entities/appInstances.ts";
import { estates } from "../entities/estates.ts";
import { sigilResourceSchema } from "./sigilResourceSchema.ts";

/**
 * One deployed copy of an app, as every surface that renders one sees it: the
 * row, plus **what it has unlocked**.
 *
 * Derived from the entity rather than hand-copied, which is how
 * `lastSeenHost` drifted to an unbounded string the last time a resource
 * restated its columns. `createdBy` is the one field dropped: a raw uuid
 * nothing on this surface resolves to a person.
 *
 * The two nested summaries are what let a caller render the right tab set from
 * one request. Both are `pick`ed from the schemas that own those rows, so a
 * column added to `sigils` or `estates` cannot ride along into a browser.
 *
 * ⚠️ There is deliberately no "has artifacts" flag. The Artifacts tab is
 * unconditional (#1774), so the presence of a build decides nothing and the
 * flag would cost a query per row of the list.
 *
 * Lives here rather than beside the controller because the browser reads it
 * too: `currentInstancesAtom` / `currentInstanceAtom` validate against this
 * schema on every write, and importing it from `AppController.ts` would pull
 * the repositories and the database provider into the client bundle.
 */
export const appInstanceResourceSchema = appInstances.schema
  .omit({ createdBy: true })
  .extend({
    /**
     * The telemetry credential, when this instance has minted one. Its
     * presence is what unlocks Analytics, Vitals, Errors and Explore.
     *
     * `name` is not here on purpose: it is a mirror of `"<app>/<env>"`, which
     * the caller already holds as two fields. Nor is `url`, a frozen dead
     * column since #1767 - the address is `instance.url` now.
     */
    sigil: sigilResourceSchema
      .pick({
        id: true,
        tokenPrefix: true,
        kinds: true,
        createdAt: true,
        lastSeenAt: true,
        lastSeenHost: true,
        reportedConfig: true,
        reportedConfigAt: true,
      })
      .optional(),
    /**
     * Where this instance deploys to, when an estate has been chosen. Enough
     * to name it on a page and no more: no credential, no liveness, no stats.
     */
    estate: estates.schema
      .pick({ id: true, slug: true, type: true, label: true })
      .optional(),
  });

export type AppInstanceResource = Infer<typeof appInstanceResourceSchema>;

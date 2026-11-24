import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projectEventFieldsSchema } from "../schemas/projectEventFieldsSchema.ts";
import { projects } from "./projects.ts";

/**
 * A fact that something changed in a project (#E159, #Q3889): a host went
 * offline, a release was published, a quest was accepted. Written with the
 * change that caused it, in the same guarded batch (`ProjectEvents`), or not
 * at all.
 *
 * - **Not a page.** The Activity page and `project_activity` read the audits,
 *   who did what; an event is what delivery reads, and a machine-detected
 *   fact has no actor. Rows are pruned after 30 days.
 * - **`fields` is data.** The message a member reads is rendered per channel
 *   from these fields by the package that owns the event.
 * - **The subject** is the resource the event is about (the deployment of a
 *   `deploy.failed`), which is not always what a subscription filters on (its
 *   app): the catalog names the filter field.
 * - Named `project_events` and not `events`: the database already holds
 *   analytics events.
 */
export const projectEvents = $entity({
  name: "project_events",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    name: z.string().min(1).max(64),
    subjectKind: z.string().min(1).max(32),
    subjectId: z.string().max(255).optional(),
    fields: projectEventFieldsSchema,
    /**
     * The account whose action caused the event, when one did (#Q3916): a
     * feedback's reporter. Read by a subscription's `notMine`. No foreign
     * key: an event outlives the account, and nothing joins on it.
     */
    actorId: z.uuid().optional(),
    /**
     * The host job whose key made the change (#Q4227), when an agent job
     * did: an automation never hears its own jobs' events, and a run an
     * event starts records this job as its parent, which the chain guard
     * reads. A soft reference.
     */
    jobId: z.uuid().optional(),
    occurredAt: z.datetime(),
  }),
  indexes: [
    { columns: ["projectId", "occurredAt"] },
    { columns: ["occurredAt"] },
  ],
});

export type ProjectEvent = Infer<typeof projectEvents.schema>;

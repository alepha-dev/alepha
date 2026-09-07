import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { appInstances } from "./appInstances.ts";
import { projects } from "./projects.ts";

/**
 * One run of "put these bytes on this instance".
 *
 * ## ⚠️ It points at the INSTANCE, and cascades from it
 *
 * A deployment says "these bytes are running **here**". With no here it is an
 * orphan nobody can act on: no rollback target, no version list, no estate to
 * reach. Epic #30 already drew this line - `app_instances` cascades from
 * `projects`, and the one reference it makes `SET NULL` is `estateId`, because
 * a *lending* can be revoked while the instance survives. An instance being
 * deleted is not that case. An audit trail that outlives its subject belongs
 * in the audit log, not in the table the Deploy tab reads.
 *
 * ⚠️ **This makes `app_instances` a cascade parent**, so
 * `apps/lore/CLAUDE.md`'s "Migration safety on D1" now applies to every later
 * migration that touches it: a generated `DROP TABLE app_instances` rebuild
 * takes this table with it, silently, on D1.
 *
 * ## ⚠️ The `(app, tag, sha256)` snapshot is not redundant
 *
 * `artifactId` is soft - no foreign key, and it may name a row that no longer
 * exists. Pushing `latest` REPLACES the artifact row, so a deployment carrying
 * only the id would start claiming it shipped bytes it never saw, which is the
 * one question content addressing exists to answer. The snapshot is what makes
 * "which version is running here" answerable after the artifact has moved on.
 *
 * ## `versionId` is what makes a fast rollback possible
 *
 * Cloudflare keeps every uploaded Worker version server-side, so pointing at an
 * older `version_id` is a rollback in seconds with no artifact and no upload -
 * working even under `latest`-only retention. ⚠️ Cloudflare-only: a Bay estate
 * has no version history, which the epic accepts for v1.
 */
export const deployments = $entity({
  name: "deployments",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The deployed copy these bytes went to.
     */
    instanceId: db.ref(z.uuid(), () => appInstances.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The artifact this run shipped, when it still exists.
     *
     * ⚠️ Soft on purpose: no foreign key, and never join through it for a
     * fact the snapshot already carries. See the class doc.
     */
    artifactId: z.uuid().optional(),
    /**
     * The snapshot. Written at the moment of the run and never updated.
     */
    app: z.string().min(1).max(100),
    tag: z.string().min(1).max(100),
    sha256: z.string().min(64).max(64),
    /**
     * `queued` while the job is waiting, `running` from its first side effect,
     * then one terminal value.
     *
     * ⚠️ A run that dies mid-deploy must reach a terminal state rather than
     * stay `running` forever, which is what the job's own failure path is for.
     */
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    /**
     * The Cloudflare version this upload produced, for {@link deployments} to
     * roll back to without touching an artifact.
     */
    versionId: z.string().max(100).optional(),
    /**
     * Where it landed, when the adapter is what put the host into effect.
     */
    url: z.string().max(500).optional(),
    /**
     * Why it failed, in the words the operator sees.
     */
    error: z.string().max(2_000).optional(),
    /**
     * The run's log, newest last.
     *
     * ⚠️ **Bounded, and the bound is the point.** A deploy that loops, or an
     * adapter that logs per asset, would otherwise write a row that grows
     * without limit into a database with a 10 GB ceiling and no sweep job for
     * this table. `DeployRegistry.MAX_LOG_LINES` trims the oldest and leaves a
     * line saying it did, so a truncated log never reads as a complete one.
     */
    log: db.default(
      z.array(z.object({ at: z.string(), text: z.string().max(500) })),
      [],
    ),
    startedAt: z.datetime().optional(),
    finishedAt: z.datetime().optional(),
    /**
     * Who asked for it. `undefined` for a deploy started by CI under a key
     * rather than by a person.
     */
    createdBy: z.uuid().optional(),
  }),
  indexes: [
    // The Deploy tab: this instance's runs, newest first.
    { columns: ["instanceId"] },
    // The project-wide view, and the rollback lookup.
    { columns: ["projectId"] },
  ],
});

export type Deployment = Infer<typeof deployments.schema>;

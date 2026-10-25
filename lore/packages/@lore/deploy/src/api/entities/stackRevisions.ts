import { users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { stacks } from "./stacks.ts";

/**
 * One revision of a stack: the bundle (`compose.yml` plus the files it
 * references, a `mosquitto.conf`, a realm import), numbered per stack.
 *
 * ## The bundle lives in object storage, like an archive
 *
 * {@link fileId} is a LOGICAL reference into the artifacts bucket, for the
 * reason `artifacts.fileId` gives: a physical `db.ref` onto `files` is a
 * table rebuild on SQLite, which on D1 is the cascade wipe documented in
 * `apps/lore/CLAUDE.md`. `StackService.delete` removes the bytes with the
 * row. {@link sha256} is what a machine verifies the pulled bytes against.
 *
 * ## The model is what every target reads; the compose text is for people
 *
 * {@link model} is the target-neutral model parsed at upload (services, app
 * references, routes, volumes, variables), stored as JSON. {@link compose} is
 * the file as written, kept so a revision can be shown and diffed. A target
 * maps from the model, never from the YAML.
 *
 * {@link digests} are the image digests the estate pinned when it applied
 * this revision, written back by the deploy, so a rollback names exactly what
 * ran.
 */
export const stackRevisions = $entity({
  name: "stack_revisions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    stackId: db.ref(z.uuid(), () => stacks.cols.id, { onDelete: "cascade" }),
    number: z.integer().min(1),
    fileId: z.uuid(),
    sha256: z.string().min(64).max(64),
    size: z.integer().min(0),
    model: z.string().max(200_000),
    compose: z.string().max(100_000),
    digests: z.record(z.string(), z.string()).optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
  }),
  indexes: [{ columns: ["stackId", "number"], unique: true }],
});

export type StackRevision = Infer<typeof stackRevisions.schema>;

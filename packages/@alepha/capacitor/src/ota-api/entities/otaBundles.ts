import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { otaApps } from "./otaApps.ts";

/**
 * One published web layer: an encrypted ZIP in storage and what it may run
 * on.
 *
 * Its compatibility is immutable: the exact native build numbers it lists
 * (`builds`), all built from one native `fingerprint`. A binary not listed
 * never receives it, however new; a newer compatible binary gets it only
 * through a new release that lists it.
 *
 * A row outlives its blob: when retention deletes the artifact the row stays
 * as `deleted`, so a version is never reused.
 */
export const otaBundles = $entity({
  name: "ota_bundles",
  schema: z.object({
    /**
     * The release id the publisher generated: a retried upload of the same
     * release lands on this row.
     */
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    appRef: db.ref(z.uuid(), () => otaApps.cols.id, { onDelete: "cascade" }),

    platform: z.enum(["ios", "android"]),
    variant: z.text({ maxLength: 64 }),

    /**
     * The version devices report once they run it.
     */
    version: z.text({ maxLength: 128 }),

    /**
     * The channel it was published to.
     */
    channel: z.text({ maxLength: 64 }),

    builds: z.array(z.text({ maxLength: 64 })),
    fingerprint: z.text({ maxLength: 128 }),
    keyId: z.text({ maxLength: 64 }),

    archiveSha256: z.text({ maxLength: 64 }),
    expandedSize: z.integer(),
    files: z.integer(),

    /**
     * The plugin's encrypted checksum and session key, sent to devices as
     * they are.
     */
    checksum: z.text({ size: "long" }),
    sessionKey: z.text({ size: "long" }),

    ciphertextSha256: z.text({ maxLength: 64 }),
    size: z.integer(),

    /**
     * `uploading` until the artifact is durable in storage, then `ready`.
     * `failed` for an upload abandoned half way, `deleted` once retention
     * removed the artifact.
     */
    status: z.enum(["uploading", "ready", "failed", "deleted"]),

    /**
     * The `$storage` file holding the ciphertext.
     */
    fileId: z.uuid().optional(),

    /**
     * Set by the kill switch: never offered again, cancelled on devices that
     * hold it at their next check, its artifact kept.
     */
    killedAt: z.datetime().optional(),
    killedReason: z.text().optional(),

    /**
     * When a download link for it was last handed out. Retention spares a
     * bundle whose link may still be in use.
     */
    lastLinkAt: z.datetime().optional(),
  }),
  indexes: [{ columns: ["appRef", "platform", "version"], unique: true }],
});

export type OtaBundleEntity = Infer<typeof otaBundles.schema>;

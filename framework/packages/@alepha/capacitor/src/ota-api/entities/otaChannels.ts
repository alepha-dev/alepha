import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { otaChannelCohortSchema } from "../schemas/otaChannelCohortSchema.ts";
import { otaApps } from "./otaApps.ts";

/**
 * A named stream of releases within an app: `production`, `beta`, a QA
 * channel. What it serves is kept per compatibility cohort, keyed
 * `<platform>:<fingerprint>`, since one channel feeds binaries that cannot
 * run each other's bundles.
 */
export const otaChannels = $entity({
  name: "ota_channels",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    appRef: db.ref(z.uuid(), () => otaApps.cols.id, { onDelete: "cascade" }),

    name: z.text({ maxLength: 64 }),

    /**
     * Whether a device may put itself on this channel (`setChannel()`). Off
     * by default: a private channel is reached only through an operator's
     * device override.
     */
    allowSelfAssign: db.default(z.boolean(), false),

    cohorts: db.default(z.record(z.text(), otaChannelCohortSchema), {}),
  }),
  indexes: [{ columns: ["appRef", "name"], unique: true }],
});

export type OtaChannelEntity = Infer<typeof otaChannels.schema>;

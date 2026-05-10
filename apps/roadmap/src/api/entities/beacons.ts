import { type Static, t } from "alepha";
import { files } from "alepha/api/files";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { quests } from "./quests.ts";

export const beacons = $entity({
  name: "beacons",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    deletedAt: db.deletedAt(),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    title: t.string({ minLength: 1, maxLength: 200 }),
    description: t.string({ maxLength: 10_000 }),
    reportType: t.enum(["bug", "feature"], { mode: "text" }),
    reporterEmail: t.optional(t.string({ format: "email" })),
    status: t.enum(["new", "promoted", "discarded"], { mode: "text" }),
    promotedQuestId: db.ref(t.optional(t.integer()), () => quests.cols.id, {
      onDelete: "set null",
    }),
    context: t.object({
      url: t.string({ maxLength: 2000 }),
      path: t.string({ maxLength: 2000 }),
      userAgent: t.string({ maxLength: 1000 }),
      viewport: t.object({
        width: t.integer(),
        height: t.integer(),
      }),
      locale: t.optional(t.string({ maxLength: 32 })),
      referrer: t.optional(t.string({ maxLength: 2000 })),
    }),
    screenshotFileId: db.ref(t.optional(t.uuid()), () => files.cols.id, {
      onDelete: "set null",
    }),
    ipHash: t.string({ maxLength: 64 }),
  }),
  indexes: [
    { columns: ["campaignId", "status", "deletedAt"] },
    { columns: ["campaignId", "createdAt"] },
  ],
});

export type Beacon = Static<typeof beacons.schema>;
export type BeaconInsert = Static<typeof beacons.insertSchema>;

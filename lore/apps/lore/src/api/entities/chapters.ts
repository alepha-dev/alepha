import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

export const chapters = $entity({
  name: "chapters",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    number: t.integer({ minimum: 1 }),
    title: t.string({ minLength: 1, maxLength: 100 }),
    description: db.default(t.string({ size: "rich" }), ""),
    closedAt: t.optional(t.datetime()),
  }),
  indexes: [
    { columns: ["campaignId"] },
    { columns: ["campaignId", "number"], unique: true },
  ],
});

export type Chapter = Static<typeof chapters.schema>;

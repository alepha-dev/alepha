import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { users } from "./users.ts";

export const quests = $entity({
  name: "quests",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    title: z.string(),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    createdBy: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    /**
     * Self-referencing FK. This exact shape is why relations cannot be
     * inferred from `db.ref` — making the reference generic enough to carry
     * its target through the type makes this line fail with TS7022.
     */
    dependsOn: db.ref(z.integer().optional(), () => quests.cols.id, {
      onDelete: "set null",
    }),
  }),
});

export type Quest = Static<typeof quests.schema>;

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
     * Soft delete, exactly as `apps/lore/src/api/entities/quests.ts` has it.
     * `Repository` filters this out of every read automatically — which is the
     * behaviour the RQB spike has to prove it can keep.
     */
    deletedAt: db.deletedAt(),
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

import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { users } from "./users.ts";

export const characters = $entity({
  name: "characters",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.string(),
    level: db.default(z.integer(), 1),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
  }),
});

export type Character = Infer<typeof characters.schema>;

import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { users } from "./users.ts";

export const campaigns = $entity({
  name: "campaigns",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    title: z.string(),
    ownerId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
  }),
});

export type Campaign = Infer<typeof campaigns.schema>;

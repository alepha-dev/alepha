import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const users = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    email: z.email(),
    name: z.string(),
  }),
});

export type User = Infer<typeof users.schema>;

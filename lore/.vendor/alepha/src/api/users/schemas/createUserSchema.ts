import type { Infer } from "alepha";

import { users } from "../entities/users.ts";
import { refusedRealmSchema } from "./refusedRealmSchema.ts";

export const createUserSchema = users.insertSchema
  .omit({ realm: true })
  .extend({ realm: refusedRealmSchema });

export type CreateUser = Infer<typeof createUserSchema>;

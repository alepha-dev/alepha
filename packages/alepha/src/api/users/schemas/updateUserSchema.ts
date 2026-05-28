import type { Static } from "alepha";
import { t } from "alepha";
import { users } from "../entities/users.ts";

export const updateUserSchema = t.partial(
  t.omit(users.insertSchema, ["id", "version", "createdAt", "updatedAt"]),
);

export type UpdateUser = Static<typeof updateUserSchema>;

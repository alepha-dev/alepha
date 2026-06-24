import type { Static } from "alepha";
import { users } from "../entities/users.ts";

export const updateUserSchema = users.insertSchema
  .omit({ id: true, version: true, createdAt: true, updatedAt: true })
  .partial();

export type UpdateUser = Static<typeof updateUserSchema>;

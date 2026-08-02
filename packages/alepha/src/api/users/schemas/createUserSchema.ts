import type { Infer } from "alepha";
import { users } from "../entities/users.ts";

export const createUserSchema = users.insertSchema.omit({ realm: true });

export type CreateUser = Infer<typeof createUserSchema>;

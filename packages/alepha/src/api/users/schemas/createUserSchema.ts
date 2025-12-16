import { type Static, t } from "alepha";
import { users } from "../entities/users.ts";

export const createUserSchema = t.omit(users.insertSchema, ["realm"]);

export type CreateUser = Static<typeof createUserSchema>;

import type { Infer } from "alepha";
import { users } from "../entities/users.ts";

export const userResourceSchema = users.schema;

export type UserResource = Infer<typeof userResourceSchema>;

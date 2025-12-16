import type { Static } from "alepha";
import { users } from "../entities/users.ts";

export const userResourceSchema = users.schema;

export type UserResource = Static<typeof userResourceSchema>;

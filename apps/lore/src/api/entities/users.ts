import type { Static } from "alepha";
import { users } from "alepha/api/users";

export { users };
export type User = Static<typeof users.schema>;

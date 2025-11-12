import { users } from "@alepha/api-users";
import type { Static } from "@alepha/core";

export { users };
export type User = Static<typeof users.schema>;

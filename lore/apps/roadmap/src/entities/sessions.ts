import { sessions } from "@alepha/api-users";
import type { Static } from "@alepha/core";

export { sessions };
export type Session = Static<typeof sessions.schema>;

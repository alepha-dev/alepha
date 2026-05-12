import type { Static } from "alepha";
import { sessions } from "alepha/api/users";

export { sessions };
export type Session = Static<typeof sessions.schema>;

import { sessions } from "alepha/api/users";
import type { Static } from "alepha";

export { sessions };
export type Session = Static<typeof sessions.schema>;

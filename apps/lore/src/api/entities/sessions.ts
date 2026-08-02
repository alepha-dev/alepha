import type { Infer } from "alepha";
import { sessions } from "alepha/api/users";

export { sessions };
export type Session = Infer<typeof sessions.schema>;

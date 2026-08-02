import type { Infer } from "alepha";
import { users } from "alepha/api/users";

export { users };
export type User = Infer<typeof users.schema>;

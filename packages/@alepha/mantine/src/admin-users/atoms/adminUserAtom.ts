import { $atom, t } from "alepha";
import { users } from "alepha/api/users";

export const adminUserAtom = $atom({
  name: "alepha.admin.user",
  schema: t.optional(users.schema),
});

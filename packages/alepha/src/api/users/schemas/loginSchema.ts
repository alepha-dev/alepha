import type { Static } from "alepha";
import { t } from "alepha";

export const loginSchema = t.object({
  username: t.text({
    minLength: 3,
    maxLength: 100,
    description: "Username or email address for login",
  }),
  password: t.text({
    minLength: 8,
    description: "User password",
  }),
});

export type LoginInput = Static<typeof loginSchema>;

import type { Static } from "alepha";
import { z } from "alepha";

export const loginSchema = z.object({
  username: z.text({
    minLength: 3,
    maxLength: 100,
    description: "Username or email address for login",
  }),
  password: z.text({
    minLength: 8,
    description: "User password",
  }),
});

export type LoginInput = Static<typeof loginSchema>;

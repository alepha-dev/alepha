import { z } from "alepha";

/**
 * The body of `setAppSecret`: one variable's name and value. Shared with the
 * Environment tab's "Add variable" dialog, which is built from the action
 * (`useActionForm`), so the form and the server check the same thing.
 *
 * `value`'s 5,000 is `AppSecretService.MAX_VALUE_LENGTH`, which lives in a
 * service this file cannot import (the browser loads it).
 */
export const setAppSecretBodySchema = z.object({
  key: z.string().min(1).max(100),
  /**
   * ⚠️ The one place a plaintext appears on the wire, and it goes one way.
   * Nothing reads it back.
   */
  value: z.string().min(1).max(5_000),
});

import { z } from "alepha";

import { automationResourceSchema } from "../../api/schemas/automationResourceSchema.ts";

/**
 * The created rule, and why it is still disabled when `enabled=true` was
 * asked for and the enable was refused. The rule exists either way, so its
 * id is never lost to the refusal.
 */
export const automationCreateResultSchema = automationResourceSchema
  .extend({
    enableRefusal: z
      .string()
      .max(1024)
      .optional()
      .describe(
        "Present only when enabled=true was requested and enabling was refused. The rule was created and stays disabled; fix the cause, then call automation_update with enabled=true and the returned revision.",
      ),
  })
  .strict();

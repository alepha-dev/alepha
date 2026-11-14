import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

import { projectErrorResourceSchema } from "../../api/schemas/projectErrorResourceSchema.ts";

// -----------------------------------------------------------------------------
// error_list
// -----------------------------------------------------------------------------

export const projectErrorListParamsSchema = projectParamsSchema.extend({
  include_resolved: z
    .boolean()
    .describe(
      "Also return resolved and quest-forwarded errors. Default false — open only.",
    )
    .optional(),
});

export const projectErrorListResultSchema = z.object({
  errors: z.array(projectErrorResourceSchema),
  openCount: z.integer(),
  /**
   * The apps that report here, for reading `sigilId` back to a name.
   */
  sigils: z.array(
    z.object({
      id: z.string(),
      /**
       * The sigil's display name — carries `sigil.name`. The wire field
       * stays `label` deliberately: this surface predates the sigil
       * reshape (app + environment + label collapsed into one `name`),
       * and renaming the field would break every existing MCP client
       * reading `error_list`. `sigil_list` reports the identical string
       * as `name` — same value, two field names, one per tool.
       */
      label: z.string(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// error_resolve
// -----------------------------------------------------------------------------

export const projectErrorResolveParamsSchema = projectParamsSchema.extend({
  error_id: z.integer().describe("The error id, from `error_list`."),
});

export const projectErrorResolveResultSchema = z.object({ ok: z.boolean() });

// -----------------------------------------------------------------------------
// error_forward
// -----------------------------------------------------------------------------

export const projectErrorForwardParamsSchema = projectParamsSchema.extend({
  error_id: z.integer().describe("The error id, from `error_list`."),
});

export const projectErrorForwardResultSchema = z.object({
  questId: z.integer(),
  questShortId: z.integer(),
});

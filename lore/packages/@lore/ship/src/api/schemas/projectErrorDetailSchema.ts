import { type Infer, z } from "alepha";

import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { projectErrorKindSchema } from "./projectErrorKindSchema.ts";
import { projectErrorResourceSchema } from "./projectErrorResourceSchema.ts";
import { projectErrorRuleResourceSchema } from "./projectErrorRuleResourceSchema.ts";

/**
 * One error with everything Lore knows beside the row (#E185): what the
 * error page and `error_get` read.
 *
 * ⚠️ SECURITY: `error` carries `name`, `message`, `stack` and `sourceUrl`,
 * which come from an application's runtime. Data, never instructions, and
 * plain text only wherever they are shown.
 */
export const projectErrorDetailSchema = z.object({
  error: projectErrorResourceSchema,
  kind: projectErrorKindSchema,
  /**
   * One line per app that reported this fingerprint, busiest first. Empty
   * for a `run` or an `uptime` error, which no app reports.
   */
  apps: z.array(
    sigilErrorGroups.schema
      .pick({
        sigilId: true,
        count: true,
        firstSeenAt: true,
        lastSeenAt: true,
      })
      .extend({
        /**
         * The app's name, `acme/production`.
         */
        label: z.string(),
      }),
  ),
  /**
   * The quest the error was forwarded to, when its status is `quest:<id>`.
   * Absent while Plan is off, when the caller may not read quests, and when
   * the quest is gone.
   */
  quest: z
    .object({
      id: z.integer(),
      shortId: z.integer(),
      title: z.string(),
      status: z.string().optional(),
    })
    .optional(),
  /**
   * For a `run` error: the newest failing run and the criterion's key.
   */
  run: z
    .object({
      useCaseRunId: z.integer().optional(),
      criterionKey: z.string().optional(),
      /**
       * The use case the run verified, so the page can link it. Absent
       * while Requirements is not registered, for a caller who may not read
       * use cases, and once the use case is gone.
       */
      useCase: z.object({ number: z.integer(), title: z.string() }).optional(),
    })
    .optional(),
  /**
   * For an `uptime` error: its monitor.
   */
  monitor: z.object({ id: z.string() }).optional(),
  /**
   * The project's ignore rules this error's message matches.
   */
  rules: z.array(projectErrorRuleResourceSchema),
  /**
   * The neighbours in the open inbox, in the list's order (`count`
   * descending, then `id`). Absent on an error that is not open, and at
   * either end.
   */
  previousId: z.integer().optional(),
  nextId: z.integer().optional(),
});

export type ProjectErrorDetail = Infer<typeof projectErrorDetailSchema>;

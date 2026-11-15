import { type Infer, z } from "alepha";

/**
 * A column's settings as the API answers them: a select's choices, and
 * whether a date column carries a time.
 */
export const folioColumnOptionsSchema = z.object({
  choices: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
      }),
    )
    .optional(),
  withTime: z.boolean().optional(),
});

export type FolioColumnOptions = Infer<typeof folioColumnOptionsSchema>;

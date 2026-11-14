import { type Infer, z } from "alepha";

/**
 * A column's settings as a caller writes them: a select's choices, each a
 * label or `{ id?, label }` (an id keeps a choice's identity across a
 * rename), and `withTime` for a date.
 */
export const folioColumnInputOptionsSchema = z.object({
  choices: z
    .array(
      z.union([
        z.string(),
        z.object({
          id: z.string().optional(),
          label: z.string(),
        }),
      ]),
    )
    .optional(),
  withTime: z.boolean().optional(),
});

export type FolioColumnInputOptions = Infer<
  typeof folioColumnInputOptionsSchema
>;

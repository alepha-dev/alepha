import { type Infer, z } from "alepha";

/**
 * What a page declares about itself with a turn: its route, a short name and
 * the data it shows. Capped at 8 KB serialized by `AiContextBlock`, which
 * truncates past it.
 */
export const aiPageContextSchema = z.object({
  route: z.text({ maxLength: 1024 }).optional(),
  page: z.text({ maxLength: 128 }).optional(),
  data: z.any().optional(),
});

export type AiPageContextInput = Infer<typeof aiPageContextSchema>;

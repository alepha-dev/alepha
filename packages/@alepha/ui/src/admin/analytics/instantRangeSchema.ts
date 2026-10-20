import { z } from "alepha";

/**
 * The two pickers of an absolute instant range, in `RangeControl`.
 */
export const instantRangeSchema = z.object({
  from: z.text().optional(),
  to: z.text().optional(),
});

import { z } from "alepha";

export const blightSigilSchema = z.object({
  id: z.uuid(),
  label: z.string(),
});

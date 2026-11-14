import { z } from "alepha";

export const projectErrorSigilSchema = z.object({
  id: z.uuid(),
  label: z.string(),
});

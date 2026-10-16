import { z } from "alepha";
export const automationAdoptionFormSchema = z.object({
  automationId: z.string().default("new"),
});

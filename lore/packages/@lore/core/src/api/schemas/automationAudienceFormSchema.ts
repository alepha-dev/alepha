import { z } from "alepha";
export const automationAudienceFormSchema = z.object({
  audience: z.enum(["member", "roster"]),
});

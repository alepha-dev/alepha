import { z } from "alepha";

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).optional(),
  logo: z.uuid().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

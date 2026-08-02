import type { Infer } from "alepha";
import { z } from "alepha";

export const createOrganizationSchema = z.object({
  name: z.text(),
  slug: z.text({ minLength: 2, maxLength: 100 }),
  enabled: z.boolean().optional(),
});

export type CreateOrganization = Infer<typeof createOrganizationSchema>;

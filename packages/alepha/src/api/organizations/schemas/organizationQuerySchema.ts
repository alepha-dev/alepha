import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const organizationQuerySchema = pageQuerySchema.extend({
  name: z.text({ description: "Filter by name (partial match)" }).optional(),
  enabled: z.boolean().describe("Filter by enabled status").optional(),
});

export type OrganizationQuery = Infer<typeof organizationQuerySchema>;

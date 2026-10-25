import { type Infer, z } from "alepha";

import { organizations } from "../entities/organizations.ts";

export const organizationSummaryResourceSchema = organizations.schema.extend({
  rank: z.text(),
});

export type OrganizationSummaryResource = Infer<
  typeof organizationSummaryResourceSchema
>;

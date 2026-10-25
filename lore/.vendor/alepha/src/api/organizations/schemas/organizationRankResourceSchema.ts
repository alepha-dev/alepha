import { type Infer, z } from "alepha";

export const organizationRankResourceSchema = z.object({
  key: z.text(),
  name: z.text(),
  permissions: z.array(z.text()),
  builtin: z.boolean(),
  editable: z.boolean(),
});

export type OrganizationRankResource = Infer<
  typeof organizationRankResourceSchema
>;

import { type Infer, z } from "alepha";

export const organizationRankResourceSchema = z.object({
  key: z.text(),
  name: z.text(),
  permissions: z.array(z.text()),
  builtin: z.boolean(),
  editable: z.boolean(),
  renamable: z.boolean(),
  /**
   * What the rank holds when nobody edited it: present for `member` and the
   * application's default ranks. A rank whose `permissions` differ from it
   * can be reset.
   */
  defaultPermissions: z.array(z.text()).optional(),
});

export type OrganizationRankResource = Infer<
  typeof organizationRankResourceSchema
>;

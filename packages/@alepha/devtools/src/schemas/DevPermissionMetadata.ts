import { type Static, z } from "alepha";

export const devPermissionMetadataSchema = z.object({
  /**
   * Permission name within its group.
   */
  name: z.text(),
  /**
   * Group the permission belongs to — the declaring service's name unless
   * `$permission({ group })` overrides it. The matrix groups rows by this.
   */
  group: z.text().optional(),
  description: z.text().optional(),
  /**
   * Canonical `group:name` string — what `$secure({ permissions })` and role
   * grants are matched against.
   */
  id: z.text(),
});

export type DevPermissionMetadata = Static<typeof devPermissionMetadataSchema>;

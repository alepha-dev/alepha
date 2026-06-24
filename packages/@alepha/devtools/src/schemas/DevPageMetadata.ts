import { type Static, z } from "alepha";

export const devPageMetadataSchema = z.object({
  name: z.text(),
  label: z.text().optional(),
  description: z.text().optional(),
  path: z.text().optional(),
  parentName: z.text().optional(),
  params: z.any().optional(),
  query: z.any().optional(),
  hasComponent: z.boolean(),
  hasLazy: z.boolean(),
  hasResolve: z.boolean(),
  childrenNames: z.array(z.text()).optional(),
  hasChildren: z.boolean(),
  hasParent: z.boolean(),
  hasErrorHandler: z.boolean(),
  static: z.boolean().optional(),
  cache: z.any().optional(),
  client: z.any().optional(),
  animation: z.any().optional(),
});

export type DevPageMetadata = Static<typeof devPageMetadataSchema>;

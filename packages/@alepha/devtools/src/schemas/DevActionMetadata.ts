import { type Static, z } from "alepha";

export const devActionMetadataSchema = z.object({
  name: z.text(),
  group: z.text(),
  method: z.text(),
  path: z.text(),
  prefix: z.text(),
  fullPath: z.text(),
  description: z.text().optional(),
  summary: z.text().optional(),
  disabled: z.boolean().optional(),
  secure: z.boolean().optional(),
  hide: z.boolean().optional(),
  body: z.any().optional(),
  params: z.any().optional(),
  query: z.any().optional(),
  response: z.any().optional(),
  bodyContentType: z.text().optional(),
  middlewares: z
    .array(
      z.object({
        name: z.text(),
        options: z.any().optional(),
      }),
    )
    .optional(),
});

export type DevActionMetadata = Static<typeof devActionMetadataSchema>;

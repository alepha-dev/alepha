import { type Infer, z } from "alepha";

export const devTopicMetadataSchema = z.object({
  name: z.text(),
  description: z.text().optional(),
  schema: z.any().optional(),
  provider: z.text(),
  subscribers: z.integer(),
});

export type DevTopicMetadata = Infer<typeof devTopicMetadataSchema>;

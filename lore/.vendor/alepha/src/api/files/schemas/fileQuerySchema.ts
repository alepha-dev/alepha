import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const fileQuerySchema = pageQuerySchema.extend({
  bucket: z.string().optional(),
  tags: z.array(z.string()).optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  creator: z.uuid().optional(),
  createdAfter: z.datetime().optional(),
  createdBefore: z.datetime().optional(),
});

export type FileQuery = Infer<typeof fileQuerySchema>;

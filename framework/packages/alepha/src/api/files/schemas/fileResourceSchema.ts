import type { Infer } from "alepha";

import { files } from "../entities/files.ts";
import { fileCreatorSummarySchema } from "./fileCreatorSummarySchema.ts";

export const fileResourceSchema = files.schema
  .extend({
    /**
     * Uploader summary, embedded by the admin listing via a best-effort
     * left join. Optional — see `fileCreatorSummarySchema`. Distinct from
     * the denormalized `creatorName`, which is set only on direct uploads
     * and never carries an email.
     */
    user: fileCreatorSummarySchema.optional(),
  })
  .meta({
    title: "FileResource",
    description: "A file resource representing a file stored in the system.",
  });

export type FileResource = Infer<typeof fileResourceSchema>;

import { type Infer, z } from "alepha";

import { folioColumnInputOptionsSchema } from "./folioColumnInputOptionsSchema.ts";
import { folioColumnTypeSchema } from "./folioColumnTypeSchema.ts";

/**
 * One change to a table's columns. A list of them is applied in order
 * (`FolioTableService.applyColumnOperations`). `column` names an existing
 * column by id, or by name without regard to case; `position` is 0-based.
 */
export const folioColumnOperationSchema = z.union([
  z.object({
    op: z.literal("add"),
    name: z.string(),
    type: folioColumnTypeSchema,
    options: folioColumnInputOptionsSchema.optional(),
    position: z.integer().min(0).optional(),
  }),
  z.object({
    op: z.literal("rename"),
    column: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal("retype"),
    column: z.string(),
    type: folioColumnTypeSchema,
    options: folioColumnInputOptionsSchema.optional(),
  }),
  z.object({
    op: z.literal("move"),
    column: z.string(),
    position: z.integer().min(0),
  }),
  z.object({
    op: z.literal("remove"),
    column: z.string(),
  }),
  z.object({
    op: z.literal("setOptions"),
    column: z.string(),
    options: folioColumnInputOptionsSchema,
  }),
]);

export type FolioColumnOperation = Infer<typeof folioColumnOperationSchema>;

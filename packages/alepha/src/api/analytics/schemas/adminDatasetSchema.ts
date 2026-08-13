import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * What the admin surface publishes about one declared dataset.
 *
 * `dimensions` / `measures` are JSON Schema objects (the output of
 * `z.toJSONSchema` on the declared zod shapes), not zod schemas — this is a
 * wire format. The admin UI rebuilds form schemas from them with
 * `jsonSchemaToZod`, the same round-trip `api/parameters` already uses.
 */
export const adminDatasetSchema = z.object({
  name: z.text(),
  index: z.text(),
  dimensions: z.record(z.text(), z.any()),
  measures: z.record(z.text(), z.any()),
  retention: z
    .object({
      hot: z.text().optional(),
      rollup: z.text().optional(),
      cold: z.text().optional(),
    })
    .optional(),
});

export type AdminDatasetDescriptor = Infer<typeof adminDatasetSchema>;

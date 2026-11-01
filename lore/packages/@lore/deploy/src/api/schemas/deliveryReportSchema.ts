import { reportsDeliverySchema } from "@lore/core/schemas";
import type { Infer } from "alepha";

import { qualityReportSchema } from "./qualityReportSchema.ts";

/**
 * The Delivery tab's whole response. Quality's half lives here rather than in
 * core: `quality_runs` is this module's.
 */
export const deliveryReportSchema = reportsDeliverySchema.extend({
  quality: qualityReportSchema,
});

export type DeliveryReport = Infer<typeof deliveryReportSchema>;

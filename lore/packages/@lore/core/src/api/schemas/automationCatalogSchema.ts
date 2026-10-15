import { z } from "alepha";

import { automationCatalogChannelSchema } from "./automationCatalogChannelSchema.ts";
import { automationCatalogEntrySchema } from "./automationCatalogEntrySchema.ts";
import { automationCatalogVariableSchema } from "./automationCatalogVariableSchema.ts";

export const automationCatalogSchema = z.object({
  entries: z.array(automationCatalogEntrySchema),
  variables: z.array(automationCatalogVariableSchema).max(100),
  variablesHasMore: z.boolean(),
  channels: z.array(automationCatalogChannelSchema),
  limits: z.object({
    selectedRows: z.literal(50),
    actions: z.literal(5),
    deliveries: z.literal(100),
    renderedBytes: z.literal(16_384),
    snapshotBytes: z.literal(65_536),
    detailDays: z.literal(30),
    receiptDays: z.literal(90),
  }),
});

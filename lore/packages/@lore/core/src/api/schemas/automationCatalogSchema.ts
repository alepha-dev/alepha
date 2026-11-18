import { z } from "alepha";

import { automationCatalogChannelSchema } from "./automationCatalogChannelSchema.ts";
import { automationCatalogEntrySchema } from "./automationCatalogEntrySchema.ts";
import { automationCatalogNodeTypeSchema } from "./automationCatalogNodeTypeSchema.ts";
import { automationCatalogPresetSchema } from "./automationCatalogPresetSchema.ts";
import { automationCatalogVariableSchema } from "./automationCatalogVariableSchema.ts";

export const automationCatalogSchema = z.object({
  presets: z.array(automationCatalogPresetSchema).max(32),
  entries: z.array(automationCatalogEntrySchema),
  /**
   * The node types a graph may hold (#Q3805), what the editor's menus
   * list.
   */
  nodeTypes: z.array(automationCatalogNodeTypeSchema),
  variables: z.array(automationCatalogVariableSchema).max(100),
  variablesHasMore: z.boolean(),
  channels: z.array(automationCatalogChannelSchema),
  limits: z.object({
    selectedRows: z.literal(50),
    actions: z.literal(5),
    /**
     * A graph's caps (#Q3803): sources, nodes, actions reachable from one
     * source.
     */
    sources: z.literal(8),
    nodes: z.literal(40),
    actionsPerSource: z.literal(5),
    deliveries: z.literal(100),
    renderedBytes: z.literal(16_384),
    snapshotBytes: z.literal(65_536),
    detailDays: z.literal(30),
    receiptDays: z.literal(90),
  }),
});

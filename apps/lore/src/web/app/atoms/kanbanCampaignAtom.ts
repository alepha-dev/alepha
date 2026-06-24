import { $atom, z } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

export const kanbanCampaignAtom = $atom({
  name: "lor.kanban.campaign",
  schema: z
    .object({
      campaign: campaigns.schema,
    })
    .optional(),
});

export const kanbanReloadAtom = $atom({
  name: "lor.kanban.reload",
  schema: z.object({
    key: z.integer(),
  }),
  default: { key: 0 },
});

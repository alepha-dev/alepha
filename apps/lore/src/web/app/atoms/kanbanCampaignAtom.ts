import { $atom, t } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

export const kanbanCampaignAtom = $atom({
  name: "lor.kanban.campaign",
  schema: t.optional(
    t.object({
      campaign: campaigns.schema,
      readOnly: t.boolean(),
    }),
  ),
});

export const kanbanReloadAtom = $atom({
  name: "lor.kanban.reload",
  schema: t.object({
    key: t.integer(),
  }),
  default: { key: 0 },
});

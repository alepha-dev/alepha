import { $atom, type Infer, z } from "alepha";

export const orderConfig = $atom({
  name: "alepha.commerce.orders",
  description: "How orders are numbered.",
  schema: z.object({
    numberPrefix: z
      .text({ maxLength: 8 })
      .describe(
        "Prefix of the order number, as in `CMD-2026-000123`. A reference for the phone, the support desk and the parcel label; the legal numbering is the invoice's.",
      ),
  }),
  default: {
    numberPrefix: "CMD",
  },
  serverOnly: true,
});

export type OrderConfig = Infer<typeof orderConfig.schema>;

declare module "alepha" {
  interface State {
    [orderConfig.key]: OrderConfig;
  }
}

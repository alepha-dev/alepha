import { type Static, t } from "alepha";

/**
 * Fare class resource schema for API responses.
 */
export const fareClassResourceSchema = t.object({
  id: t.uuid(),
  code: t.text(),
  name: t.text(),
  description: t.text(),
  price: t.number(),
  priceMultiplier: t.number(),
  dynamicMultiplier: t.number(),
  remainingQuota: t.integer(),
  isRefundable: t.boolean(),
  isChangeable: t.boolean(),
  changeFeePercent: t.number(),
  refundFeePercent: t.number(),
  minDaysBeforeDeparture: t.integer(),
});

export type FareClassResource = Static<typeof fareClassResourceSchema>;

import type { Static } from "alepha";
import { refunds } from "../entities/refunds.ts";

export const refundResourceSchema = refunds.schema;

export type RefundResource = Static<typeof refundResourceSchema>;

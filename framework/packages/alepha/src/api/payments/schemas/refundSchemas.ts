import type { Infer } from "alepha";

import { refunds } from "../entities/refunds.ts";

export const refundResourceSchema = refunds.schema;

export type RefundResource = Infer<typeof refundResourceSchema>;

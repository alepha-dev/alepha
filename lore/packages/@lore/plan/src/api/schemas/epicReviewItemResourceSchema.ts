import { type Infer } from "alepha";

import { epicReviewItems } from "../entities/epicReviewItems.ts";

/**
 * One review item as the API answers it: the row, as stored (#E121).
 */
export const epicReviewItemResourceSchema = epicReviewItems.schema;

export type EpicReviewItemResource = Infer<typeof epicReviewItemResourceSchema>;

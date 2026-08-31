import { type Infer, z } from "alepha";

/**
 * Which population an Insights read counts.
 *
 * One declaration for four call sites that must agree: the `getInsights`
 * query, the payload that echoes it back, the `$analytics()` view filter and
 * the unique-visitor window. They used to be four copies of the same string
 * union, which is three chances to add a value in one place and not the
 * others.
 *
 * `all` is what an omitted parameter means, so every caller predating the
 * filter keeps the answer it always got.
 *
 * **`humans` means "did not declare itself a crawler", not "verified human".**
 * A scraper driving a real browser sends an ordinary user-agent and lands in
 * this bucket; what gives it away is that it never scrolls, which is what the
 * `engaged` measure records. See `sigilTrafficKind` in `@alepha/lore`.
 */
export const trafficFilterSchema = z.enum(["all", "humans", "bots"]);

export type TrafficFilter = Infer<typeof trafficFilterSchema>;

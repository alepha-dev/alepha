import { type Infer, z } from "alepha";

/**
 * Where clicking goes, as a route name plus params: a card's own
 * drill-through, and each row of a list, status or feed tile.
 *
 * The names are `$page` keys, so the browser hands this straight to
 * `router.push`. See `DashboardCardLink` for why it is a name and not a URL.
 */
export const dashboardCardLinkSchema = z.object({
  route: z.string(),
  params: z.record(z.text(), z.string()).optional(),
  query: z.record(z.text(), z.string()).optional(),
});

export type DashboardCardLinkValue = Infer<typeof dashboardCardLinkSchema>;

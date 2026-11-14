import { LayoutDashboard } from "lucide-react";
import { Fragment } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../core/Empty.tsx";
import type { AdminDashboardCard } from "./AdminDashboardCard.tsx";
import {
  type AdminDashboardLayoutTile,
  resolveAdminDashboardLayout,
} from "./adminDashboardLayout.ts";
import { AdminPage } from "./AdminPage.tsx";

export interface AdminDashboardProps {
  /**
   * The catalog: built-in cards followed by the application's, already
   * concatenated by `AdminRouter`. Ordering and gating happen here rather
   * than there so the two sets obey exactly one rule.
   */
  cards?: AdminDashboardCard[];

  /**
   * The deployment's stored layout, loaded by the page's loader before the
   * first render so the grid never reflows. Absent or empty means the code
   * defaults.
   */
  layout?: { tiles: AdminDashboardLayoutTile[] };

  /**
   * The stored layout's version, which a save sends back. Absent when the
   * layout API is not registered or not readable.
   */
  layoutVersion?: number;
}

/**
 * The admin landing page: whatever cards survive their own `can` gate.
 *
 * An admin whose deployment registers no module a card can read sees the
 * empty state rather than a page of dashes — which is the honest rendering of
 * "there is nothing to summarise here", and the same reasoning that hides a
 * nav entry whose backend never shipped.
 */
const AdminDashboard = (props: AdminDashboardProps) => {
  const cards = resolveAdminDashboardLayout(
    props.cards ?? [],
    props.layout?.tiles,
  );

  return (
    // `p-6`, not the shell's `p-2`. That 8px frame is for the table pages,
    // whose table draws its own edge; this page is a grid of cards, and cards
    // sitting 8px off the layout read as unframed (#Q2291). The one call site
    // of `AdminPage` that is not a table, hence the only one that overrides.
    <AdminPage className="p-6">
      {cards.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutDashboard className="size-4" />
            </EmptyMedia>
            <EmptyTitle>Nothing to summarise</EmptyTitle>
            <EmptyDescription>
              No module this dashboard can read is registered.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <Fragment key={card.id}>{card.render()}</Fragment>
          ))}
        </div>
      )}
    </AdminPage>
  );
};

export default AdminDashboard;

import type { AdminDashboardCard } from "@alepha/ui/components/admin/admin-dashboard-card";
import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alepha/ui/components/ui/empty";
import { LayoutDashboard } from "lucide-react";
import { Fragment } from "react";

export interface AdminDashboardProps {
  /**
   * Built-in cards followed by the application's, already concatenated by
   * `AdminRouter`. Ordering and gating happen here rather than there so the
   * two sets obey exactly one rule.
   */
  cards?: AdminDashboardCard[];
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
  const cards = (props.cards ?? [])
    .filter((card) => (card.can ? card.can() : true))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <AdminPage>
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

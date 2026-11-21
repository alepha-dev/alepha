import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { LayoutDashboard } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../core/Empty.tsx";
import type { AdminDashboardCard } from "./AdminDashboardCard.tsx";
import { visibleAdminDashboardCards } from "./adminDashboardCards.ts";
import { AdminPage } from "./AdminPage.tsx";

export interface AdminDashboardProps {
  /**
   * The tiles: built-in cards followed by the application's, already
   * concatenated by `AdminRouter`. Ordering and gating happen here rather
   * than there so the two sets obey exactly one rule.
   */
  cards?: AdminDashboardCard[];
}

/**
 * The admin landing page: a greeting, then whatever cards survive their own
 * `can` gate, in the order the code declares (#Q3667: nothing stored, nothing
 * an admin rearranges).
 *
 * An admin whose deployment registers no module a card can read sees the
 * empty state rather than a page of dashes, which is the honest rendering of
 * "there is nothing to summarise here", and the same reasoning that hides a
 * nav entry whose backend never shipped.
 */
const AdminDashboard = (props: AdminDashboardProps) => {
  const { tr } = useI18n();
  const auth = useAuth();
  const cards = visibleAdminDashboardCards(props.cards ?? []);
  const user = auth.user as
    | { name?: string; username?: string; email?: string }
    | undefined;
  // The name, else the username, else the email's local part.
  const who =
    user?.name?.trim() || user?.username || user?.email?.split("@")[0];

  return (
    // `p-6`, not the shell's `p-2`. That 8px frame is for the table pages,
    // whose table draws its own edge; this page is a grid of cards, and cards
    // sitting 8px off the layout read as unframed (#Q2291). The one call site
    // of `AdminPage` that is not a table, hence the only one that overrides.
    <AdminPage className="p-6">
      {who ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="admin-dashboard-hello"
        >
          {tr("admin.dashboard.hello", {
            args: [who],
            default: "Hello $1",
          })}
        </p>
      ) : null}
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            // `grid`, so the tile inside stretches to the row's height as it
            // did when it was the grid's own item.
            <section
              key={card.id}
              className="grid"
              aria-label={
                card.titleKey
                  ? tr(card.titleKey, { default: card.title })
                  : card.title
              }
            >
              {card.render()}
            </section>
          ))}
        </div>
      )}
    </AdminPage>
  );
};

export default AdminDashboard;

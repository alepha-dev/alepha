import type { AdminProductController } from "@alepha/commerce/admin";
import { AdminDashboardCountCard } from "@alepha/ui/components/admin/admin-dashboard-count-card";
import { useClient } from "alepha/react";
import { Tr } from "alepha/react/i18n";
import { Gem } from "lucide-react";

/**
 * Dashboard tile: how many pieces the catalogue holds, drafts included.
 *
 * A thin wrapper around the shared count tile rather than a card of its own —
 * the component exists only because `useClient` is a hook and the card
 * contract's `load` is a plain function, so something has to sit between them.
 *
 * It declares no `can` where it is registered: this is the shop's own
 * commerce module, which the shop always mounts. The gate matters for the
 * built-in cards, whose modules an application may legitimately not have.
 */
export const AdminCartePieces = () => {
  const client = useClient<AdminProductController>();
  return (
    <AdminDashboardCountCard
      label={<Tr k="admin.produits" />}
      href="/admin/produits"
      icon={<Gem className="size-4" />}
      load={async () =>
        (await client.commerceAdminProductList({ query: { size: 1 } })).page
          .totalElements ?? 0
      }
    />
  );
};

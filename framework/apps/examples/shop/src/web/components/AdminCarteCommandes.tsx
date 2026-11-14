import type { AdminOrderController } from "@alepha/commerce/admin";
import { AdminStatTile } from "@alepha/ui/admin";
import { useClient } from "alepha/react";
import { Tr } from "alepha/react/i18n";
import { Package } from "lucide-react";

/**
 * Dashboard tile: how many orders have been placed.
 *
 * See {@link AdminCartePieces} for why this wrapper exists at all.
 */
export const AdminCarteCommandes = () => {
  const client = useClient<AdminOrderController>();
  return (
    <AdminStatTile
      id="shop-commandes"
      label={<Tr k="admin.orders" />}
      href="/admin/commandes"
      icon={<Package className="size-4" />}
      load={async () =>
        (await client.commerceAdminOrderList({ query: { size: 1 } })).page
          .totalElements ?? 0
      }
    />
  );
};

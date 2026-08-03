import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { useI18n } from "alepha/react/i18n";
import { NestedView } from "alepha/react/router";
import { Gem, Package, Store, Truck } from "lucide-react";
import { Poincon } from "./components/Poincon.tsx";

/**
 * The back office shell.
 *
 * `AppShell` from `@alepha/ui` supplies the sidebar, the mobile drawer, the
 * toaster and the action-error toaster — none of which is worth rebuilding, and
 * all of which the storefront deliberately does *not* use. A catalogue of six
 * pieces needs no sidebar; a back office does.
 */
export const AdminLayout = () => {
  const { tr } = useI18n();

  return (
    <AppShell
      brand={
        <div className="flex items-center gap-3">
          <Poincon titre="AA" />
          <span className="estampe text-xs">{tr("admin.brand")}</span>
        </div>
      }
      nav={[
        {
          label: String(tr("admin.group")),
          items: [
            {
              href: "/admin/pieces",
              label: String(tr("admin.pieces")),
              icon: Gem,
            },
            {
              href: "/admin/commandes",
              label: String(tr("admin.orders")),
              icon: Package,
            },
            {
              href: "/admin/livraison",
              label: String(tr("admin.shipping")),
              icon: Truck,
            },
            { href: "/", label: String(tr("admin.viewShop")), icon: Store },
          ],
        },
      ]}
      topbarActions={
        <>
          <ButtonTheme />
          <ButtonUser />
        </>
      }
    >
      <NestedView />
    </AppShell>
  );
};
